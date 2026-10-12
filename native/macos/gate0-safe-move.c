// macOS bounded native helper; no destructive production setup integration.
// Anchor every ancestor from "/" using openat(O_DIRECTORY|O_NOFOLLOW).
// Exactly one source and target *in the same verified parent directory* per call.
// Compile/test only on macOS; this does not implement manifest journaling or recovery.
#define _DARWIN_C_SOURCE 1
#include <CommonCrypto/CommonDigest.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int valid_segment(const char *name) {
  if (!name || !*name || !strcmp(name, ".") || !strcmp(name, "..")) return 0;
  for (const unsigned char *p=(const unsigned char *)name; *p; ++p) {
    if (*p == '/' || *p == '\\' || *p == ':' || *p < 32 || *p == 127) return 0;
  }
  return 1;
}

static int valid_digest(const char *text) {
  if (!text || strlen(text) != 64) return 0;
  for (int i=0;i<64;i++) if (!((text[i]>='0'&&text[i]<='9') ||
                                (text[i]>='a'&&text[i]<='f'))) return 0;
  return 1;
}

/** Each component is opened relative to its pinned, non-symlink directory fd. */
static int descend(int *dir, const char *relative) {
  if (!relative || !*relative || relative[0] == '/') return -1;
  const char *start = relative;
  for (const char *p = relative; ; ++p) {
    if (*p != '/' && *p != '\0') continue;
    size_t len = (size_t)(p - start);
    if (len == 0 || len > 255) return -1;
    char part[256];
    memcpy(part, start, len);
    part[len] = '\0';
    if (!valid_segment(part)) return -1;
    int next = openat(*dir, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (next < 0) return -1;
    close(*dir);
    *dir = next;
    if (*p == '\0') return 0;
    start = p + 1;
  }
}

/**
 * Explicit absolute physical Workspace root; symlink anywhere in its ancestor
 * chain is rejected. Relative parent "." is the Workspace root itself.
 * The caller still owns semantic managed-path namespace and alias validation.
 */
static int open_anchored_parent(const char *root, const char *parent) {
  if (!root || root[0] != '/' || !root[1] ||
      !parent || !*parent || (strcmp(parent, ".") && parent[0] == '/')) {
    errno = EINVAL; return -1;
  }
  int dir = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (dir < 0) return -1;
  if (descend(&dir, root + 1) ||
      (strcmp(parent, ".") && descend(&dir, parent))) {
    int saved = errno;
    close(dir);
    errno = saved == 0 ? EINVAL : saved;
    return -1;
  }
  return dir;
}

/** Pinned regular file and exact digest; inode compared before/after hashing. */
static int check_file(int dir, const char *name, const char *expected, struct stat *identity) {
  int fd = openat(dir, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return -1;
  struct stat before, after, leaf;
  int ok = 0;
  if (fstat(fd, &before) || !S_ISREG(before.st_mode)) goto done;
  CC_SHA256_CTX ctx;
  if (!CC_SHA256_Init(&ctx)) goto done;
  unsigned char block[8192];
  ssize_t n;
  while ((n = read(fd, block, sizeof(block))) > 0) {
    if (!CC_SHA256_Update(&ctx, block, (CC_LONG)n)) goto done;
  }
  if (n < 0) goto done;
  unsigned char bytes[CC_SHA256_DIGEST_LENGTH];
  if (!CC_SHA256_Final(bytes, &ctx)) goto done;
  if (fstat(fd, &after) || fstatat(dir, name, &leaf, AT_SYMLINK_NOFOLLOW)) goto done;
  if (!S_ISREG(after.st_mode) || !S_ISREG(leaf.st_mode) ||
      before.st_dev != after.st_dev || before.st_ino != after.st_ino ||
      after.st_dev != leaf.st_dev || after.st_ino != leaf.st_ino ||
      before.st_size != after.st_size) goto done;
  char hex[65];
  for (int i=0;i<32;i++) snprintf(hex+2*i, 3, "%02x", bytes[i]);
  ok = strcmp(hex, expected) == 0;
  if (ok && identity) *identity = after;
done:
  close(fd);
  if (!ok) errno = EBUSY;
  return ok ? 0 : -1;
}

static void test_pause(const char *name) {
#ifdef GATE0_TEST_HOOKS
  const char *text = getenv(name);
  if (text && *text) {
    long us = strtol(text, NULL, 10);
    if (us > 0 && us <= 2000000) usleep((useconds_t)us);
  }
#else
  (void)name;
#endif
}

/** Test-only signal + pause for deterministic SIGKILL after atomic move. */
static void test_after_move(void) {
#ifdef GATE0_TEST_HOOKS
  const char *flag = getenv("GATE0_TEST_AFTER_MOVE_SIGNAL");
  if (flag && *flag) {
    int fd = open(flag, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    if (fd >= 0) { (void)write(fd, "moved\n", 6); close(fd); }
  }
#endif
  test_pause("GATE0_TEST_AFTER_MOVE_DELAY_US");
}

static int move_no_replace(int dir, const char *from, const char *to) {
  return renameatx_np(dir, from, dir, to, RENAME_EXCL);
}

/**
 * Write a new sibling stage from stdin. Unlike pathname-based Node writes,
 * openat pins the verified parent and O_EXCL refuses an intervening file.
 * A partial/failed stage is kept for journal-led investigation, never deleted
 * through a racy pathname. Maximum payload is 16 MiB.
 */
static int stage_exclusive(const char *root, const char *parent,
                           const char *target, const char *hash) {
  if (!valid_segment(target) || !valid_digest(hash)) {
    fprintf(stderr, "Invalid stage destination or digest\\n"); return 64;
  }
  int dir = open_anchored_parent(root, parent);
  if (dir < 0) { perror("stage anchored parent"); return 2; }
  int fd = openat(dir, target, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) { perror("stage exists or cannot create"); close(dir); return 4; }

  struct stat initial, after, leaf, verified;
  int ok = 1;
  if (fstat(fd, &initial) || !S_ISREG(initial.st_mode)) ok = 0;
  CC_SHA256_CTX ctx;
  if (ok && !CC_SHA256_Init(&ctx)) ok = 0;
  unsigned char block[8192];
  size_t total = 0;
  while (ok) {
    ssize_t n = read(STDIN_FILENO, block, sizeof(block));
    if (n == 0) break;
    if (n < 0) {
      if (errno == EINTR) continue;
      ok = 0; break;
    }
    total += (size_t)n;
    if (total > 16 * 1024 * 1024 ||
        !CC_SHA256_Update(&ctx, block, (CC_LONG)n)) { ok = 0; break; }
    ssize_t consumed = 0;
    while (consumed < n) {
      ssize_t written = write(fd, block + consumed, (size_t)(n - consumed));
      if (written < 0 && errno == EINTR) continue;
      if (written <= 0) { ok = 0; break; }
      consumed += written;
    }
  }
  unsigned char bytes[CC_SHA256_DIGEST_LENGTH];
  if (ok && !CC_SHA256_Final(bytes, &ctx)) ok = 0;
  char actual[65] = {0};
  if (ok) {
    for (int i=0;i<32;i++) snprintf(actual+2*i, 3, "%02x", bytes[i]);
    if (strcmp(actual, hash) != 0) ok = 0;
  }
  if (ok && fsync(fd)) ok = 0;
  if (ok && (fstat(fd, &after) ||
             after.st_dev != initial.st_dev || after.st_ino != initial.st_ino ||
             after.st_size != (off_t)total)) ok = 0;
  close(fd);
  if (ok && (fstatat(dir, target, &leaf, AT_SYMLINK_NOFOLLOW) ||
             !S_ISREG(leaf.st_mode) ||
             leaf.st_dev != initial.st_dev || leaf.st_ino != initial.st_ino)) ok = 0;
  if (ok && (check_file(dir, target, hash, &verified) ||
             verified.st_dev != initial.st_dev || verified.st_ino != initial.st_ino)) ok = 0;
  close(dir);
  if (!ok) {
    fprintf(stderr, "Stage integrity, size or identity conflict; preserve any partial file for recovery\\n");
    return 5;
  }
  puts("stage OK");
  return 0;
}

int main(int argc, char **argv) {
  // Strict, side-effect-free packaged-helper protocol probe.
  if (argc == 2 && !strcmp(argv[1], "--probe")) {
#if defined(__arm64__) || defined(__aarch64__)
    puts("chat-harness-macos-helper/1 darwin-arm64");
#elif defined(__x86_64__)
    puts("chat-harness-macos-helper/1 darwin-x64");
#else
    fprintf(stderr, "Unsupported native helper architecture\n");
    return 64;
#endif
    return 0;
  }
  if (argc == 6 && !strcmp(argv[1], "stage")) {
    return stage_exclusive(argv[2], argv[3], argv[4], argv[5]);
  }
  if (argc != 7 || (strcmp(argv[1], "move") && strcmp(argv[1], "promote") &&
                    strcmp(argv[1], "restore"))) {
    fprintf(stderr, "Usage: gate0-safe-move move|promote|restore WORKSPACE_ROOT RELATIVE_PARENT SOURCE_BASE TARGET_BASE SHA256_HEX\n");
    return 64;
  }
  const char *op=argv[1], *source=argv[4], *target=argv[5], *hash=argv[6];
  if (!valid_segment(source) || !valid_segment(target) || !strcmp(source, target) ||
      !valid_digest(hash)) {
    fprintf(stderr, "Invalid leaf name or digest\n"); return 64;
  }
  int dir = open_anchored_parent(argv[2], argv[3]);
  if (dir < 0) { perror("open anchored Workspace parent"); return 2; }
  struct stat initial, moved;
  if (check_file(dir, source, hash, &initial)) {
    fprintf(stderr, "Source identity/content does not match expected digest\n");
    close(dir); return 3;
  }
  test_pause("GATE0_TEST_DELAY_US");
  if (move_no_replace(dir, source, target)) {
    perror("destination exists, unsupported filesystem, or rename conflict");
    close(dir); return 4;
  }
  test_after_move();
  if (check_file(dir, target, hash, &moved) ||
      moved.st_dev != initial.st_dev || moved.st_ino != initial.st_ino) {
    // A different inode with identical bytes is still an intervening source.
    // Keep the unexpected bytes. Restore by no-replace if possible.
    if (!move_no_replace(dir, target, source)) {
      fprintf(stderr, "Post-move conflict; moved bytes restored without overwrite\n");
    } else {
      fprintf(stderr, "Post-move conflict; source occupied, moved bytes preserved at target\n");
    }
    close(dir); return 5;
  }
  close(dir);
  printf("%s OK\n", op);
  return 0;
}
