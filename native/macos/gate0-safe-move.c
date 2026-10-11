// macOS Gate 0 feasibility SPIKE: single-directory, handle-relative, no-replace file moves.
// Not a released helper, not wired into setup, manifest mutation or recovery.
// Compile on macOS: cc -std=c11 -Wall -Wextra native/macos/gate0-safe-move.c -o gate0-safe-move
#define _DARWIN_C_SOURCE 1
#include <CommonCrypto/CommonDigest.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int valid_base(const char *name) {
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

// Pinned regular file, no leaf symlink, before/after inode check and exact SHA-256.
// A simultaneous in-place writer is detected by the post-move verification.
static int check_file(int dir, const char *name, const char *expected) {
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
done:
  close(fd);
  if (!ok) errno = EBUSY; // mismatch or unproven identity is a conflict
  return ok ? 0 : -1;
}

static void test_pause(void) {
#ifdef GATE0_TEST_HOOKS
  const char *text = getenv("GATE0_TEST_DELAY_US");
  if (text && *text) {
    long us = strtol(text, NULL, 10);
    if (us > 0 && us <= 2000000) usleep((useconds_t)us);
  }
#endif
}

static int move_no_replace(int dir, const char *from, const char *to) {
  // RENAME_EXCL refuses an occupied destination; rename() would not.
  return renameatx_np(dir, from, dir, to, RENAME_EXCL);
}

int main(int argc, char **argv) {
  if (argc != 6 || (strcmp(argv[1], "move") && strcmp(argv[1], "promote") &&
                    strcmp(argv[1], "restore"))) {
    fprintf(stderr, "Usage: gate0-safe-move move|promote|restore PARENT_DIR SOURCE_BASE TARGET_BASE SHA256_HEX\n");
    return 64;
  }
  const char *op=argv[1], *source=argv[3], *target=argv[4], *hash=argv[5];
  if (!valid_base(source) || !valid_base(target) || !strcmp(source, target) ||
      !valid_digest(hash)) {
    fprintf(stderr, "Invalid leaf name or digest\n"); return 64;
  }
  // This proof requires caller to pass a trusted, already-inspected parent path.
  // Opening the directory with O_NOFOLLOW pins it throughout this invocation.
  int dir = open(argv[2], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (dir < 0) { perror("open parent directory"); return 2; }
  if (check_file(dir, source, hash)) {
    fprintf(stderr, "Source identity/content does not match expected digest\n");
    close(dir); return 3;
  }
  test_pause();
  if (move_no_replace(dir, source, target)) {
    perror("destination exists, unsupported filesystem, or rename conflict");
    close(dir); return 4;
  }
  if (check_file(dir, target, hash)) {
    // Move-back uses no-replace too. If someone now owns SOURCE, preserve TARGET.
    if (!move_no_replace(dir, target, source)) {
      fprintf(stderr, "Post-move digest conflict; changed source restored without overwrite\n");
    } else {
      fprintf(stderr, "Post-move digest conflict; original filename occupied, backup preserved\n");
    }
    close(dir); return 5;
  }
  close(dir);
  printf("%s OK\n", op);
  return 0;
}
