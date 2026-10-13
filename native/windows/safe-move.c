/* Windows x64, local NTFS only. All managed I/O is handle-relative.
 * Retain physical ancestor handles without delete sharing. Source handles
 * deny write/delete sharing through hashing and conditional handle rename.
 * No pathname rename, overwrite, runtime compiler or filesystem fallback.
 * Process interruption recovery belongs to the schema-1 TypeScript engine. */
#define _WIN32_WINNT 0x0602
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winternl.h>
#include <bcrypt.h>
#include <tlhelp32.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <wchar.h>
#include <io.h>
#include <fcntl.h>
#include <stddef.h>

#ifndef FILE_OPEN_REPARSE_POINT
#define FILE_OPEN_REPARSE_POINT 0x00200000
#endif
#ifndef FILE_SYNCHRONOUS_IO_NONALERT
#define FILE_SYNCHRONOUS_IO_NONALERT 0x00000020
#endif
#ifndef FILE_DIRECTORY_FILE
#define FILE_DIRECTORY_FILE 0x00000001
#endif
#ifndef FILE_NON_DIRECTORY_FILE
#define FILE_NON_DIRECTORY_FILE 0x00000040
#endif
#ifndef FILE_OPEN
#define FILE_OPEN 1
#define FILE_CREATE 2
#endif

typedef NTSTATUS (NTAPI *CREATE_FN)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES,
    PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
typedef NTSTATUS (NTAPI *SET_FN)(HANDLE, PIO_STATUS_BLOCK, PVOID, ULONG, ULONG);
typedef struct { BOOLEAN replace; HANDLE parent; ULONG length; WCHAR name[1]; } RENAME_INFO;
typedef struct { DWORD volume; ULONGLONG index; } IDENTITY;
static CREATE_FN nt_create;
static SET_FN nt_set;
static HANDLE held[512];
static size_t held_count;
static HANDLE mutation_gate;
static IDENTITY root_expected, temp_expected;
static int guarded_root, guarded_temp;
static DWORD owner_pid, lease_pid;

static int remember(HANDLE h) {
  if (h == INVALID_HANDLE_VALUE || !h || held_count == 512) { if(h && h != INVALID_HANDLE_VALUE)CloseHandle(h); return 0; }
  held[held_count++] = h; return 1;
}
static int identity(HANDLE h, IDENTITY *id) {
  BY_HANDLE_FILE_INFORMATION s;
  if (!GetFileInformationByHandle(h,&s) || (s.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) return 0;
  id->volume=s.dwVolumeSerialNumber;
  id->index=((ULONGLONG)s.nFileIndexHigh << 32) | s.nFileIndexLow;
  return 1;
}
static int same_id(IDENTITY a, IDENTITY b) { return a.volume==b.volume && a.index==b.index; }
static int segment(const WCHAR *s) {
  size_t n=wcslen(s);
  if(!n || n>255 || !wcscmp(s,L".") || !wcscmp(s,L"..") || s[n-1]==L'.' || s[n-1]==L' ')return 0;
  for(size_t i=0;i<n;i++)if(s[i]<32 || s[i]==127 || wcschr(L"/\\:<>\"|?*",s[i]))return 0;
  WCHAR base[256];wcscpy(base,s);WCHAR *dot=wcschr(base,L'.');if(dot)*dot=0;
  if(!_wcsicmp(base,L"CON") || !_wcsicmp(base,L"PRN") || !_wcsicmp(base,L"AUX") || !_wcsicmp(base,L"NUL"))return 0;
  if(wcslen(base)==4 && ((!_wcsnicmp(base,L"COM",3)) || (!_wcsnicmp(base,L"LPT",3))) && base[3]>=L'1' && base[3]<=L'9')return 0;
  return 1;
}
static int digest_valid(const WCHAR *s) {
  if(wcslen(s)!=64)return 0;
  for(int i=0;i<64;i++)if(!((s[i]>=L'0'&&s[i]<=L'9') || (s[i]>=L'a'&&s[i]<=L'f')))return 0;
  return 1;
}
static HANDLE relative_open(HANDLE parent,const WCHAR *name,ACCESS_MASK access,int directory,int create) {
  if(!segment(name))return INVALID_HANDLE_VALUE;
  UNICODE_STRING text; text.Buffer=(PWSTR)name;text.Length=(USHORT)(wcslen(name)*sizeof(WCHAR));text.MaximumLength=text.Length;
  OBJECT_ATTRIBUTES attributes;
  memset(&attributes,0,sizeof(attributes));attributes.Length=sizeof(attributes);
  attributes.RootDirectory=parent;attributes.ObjectName=&text;attributes.Attributes=0x40; /* OBJ_CASE_INSENSITIVE */
  IO_STATUS_BLOCK io;HANDLE h=NULL;
  ULONG share=directory ? FILE_SHARE_READ|FILE_SHARE_WRITE : FILE_SHARE_READ;
  NTSTATUS status=nt_create(&h,access|SYNCHRONIZE,&attributes,&io,NULL,FILE_ATTRIBUTE_NORMAL,
    share,create ? FILE_CREATE : FILE_OPEN,FILE_OPEN_REPARSE_POINT|FILE_SYNCHRONOUS_IO_NONALERT|
    (directory ? FILE_DIRECTORY_FILE : FILE_NON_DIRECTORY_FILE),NULL,0);
  if(status<0)return INVALID_HANDLE_VALUE;
  BY_HANDLE_FILE_INFORMATION info;
  if(!GetFileInformationByHandle(h,&info) || (info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT) ||
     !!(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)!=!!directory) {CloseHandle(h);return INVALID_HANDLE_VALUE;}
  return h;
}
static HANDLE descend(HANDLE parent,const WCHAR *relative) {
  const WCHAR *start=relative;
  for(const WCHAR *p=relative;;p++) {
    if(*p && *p!=L'/' && *p!=L'\\')continue;
    size_t n=(size_t)(p-start);if(!n || n>255)return INVALID_HANDLE_VALUE;
    WCHAR part[256];wmemcpy(part,start,n);part[n]=0;
    HANDLE next=relative_open(parent,part,FILE_LIST_DIRECTORY|FILE_TRAVERSE|FILE_READ_ATTRIBUTES,1,0);
    if(!remember(next))return INVALID_HANDLE_VALUE;
    parent=next;if(!*p)return parent;start=p+1;
  }
}
static HANDLE anchored(const WCHAR *root,const WCHAR *parent) {
  /* No UNC, device namespace, relative drive path or drive-root Workspace. */
  size_t length=wcslen(root);
  if(length<4 || !((root[0]>=L'A'&&root[0]<=L'Z')||(root[0]>=L'a'&&root[0]<=L'z')) ||
     root[1]!=L':' || (root[2]!=L'\\' && root[2]!=L'/') || !*parent)return INVALID_HANDLE_VALUE;
  WCHAR volume[8]={root[0],L':',L'\\',0}, fs[32];
  if(GetDriveTypeW(volume)!=DRIVE_FIXED || !GetVolumeInformationW(volume,NULL,0,NULL,NULL,NULL,fs,32) || wcscmp(fs,L"NTFS"))return INVALID_HANDLE_VALUE;
  HANDLE dir=CreateFileW(volume,FILE_LIST_DIRECTORY|FILE_TRAVERSE|FILE_READ_ATTRIBUTES|SYNCHRONIZE,
    FILE_SHARE_READ|FILE_SHARE_WRITE,NULL,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,NULL);
  if(!remember(dir))return INVALID_HANDLE_VALUE;
  dir=descend(dir,root+3);IDENTITY actual;
  if(dir==INVALID_HANDLE_VALUE || !identity(dir,&actual) || (guarded_root && !same_id(actual,root_expected)))return INVALID_HANDLE_VALUE;
  if(!wcscmp(parent,L"."))return dir;
  /* Managed relative paths always use the canonical POSIX slash form. */
  if(wcschr(parent,L'\\'))return INVALID_HANDLE_VALUE;
  return descend(dir,parent);
}
static int hash_handle(HANDLE h,const WCHAR *expected,IDENTITY *id) {
  BY_HANDLE_FILE_INFORMATION before,after;LARGE_INTEGER zero;zero.QuadPart=0;
  if(!GetFileInformationByHandle(h,&before) || (before.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT)) ||
     before.nFileSizeHigh || before.nFileSizeLow>16*1024*1024 || !SetFilePointerEx(h,zero,NULL,FILE_BEGIN))return 0;
  BCRYPT_ALG_HANDLE alg=NULL;BCRYPT_HASH_HANDLE hash=NULL;PUCHAR object=NULL;
  DWORD object_size=0,copied=0;int ok=0;unsigned char bytes[32],block[8192];WCHAR actual[65];
  if(BCryptOpenAlgorithmProvider(&alg,BCRYPT_SHA256_ALGORITHM,NULL,0)<0 ||
     BCryptGetProperty(alg,BCRYPT_OBJECT_LENGTH,(PUCHAR)&object_size,sizeof(object_size),&copied,0)<0)goto done;
  object=(PUCHAR)malloc(object_size);if(!object)goto done;
  if(BCryptCreateHash(alg,&hash,object,object_size,NULL,0,0)<0)goto done;
  DWORD n,total=0;
  for(;;){if(!ReadFile(h,block,sizeof(block),&n,NULL))goto done;if(!n)break;
    total+=n;if(total>16*1024*1024 || BCryptHashData(hash,block,n,0)<0)goto done;}
  if(BCryptFinishHash(hash,bytes,sizeof(bytes),0)<0 || !GetFileInformationByHandle(h,&after) ||
    before.dwVolumeSerialNumber!=after.dwVolumeSerialNumber || before.nFileIndexHigh!=after.nFileIndexHigh ||
    before.nFileIndexLow!=after.nFileIndexLow || before.nFileSizeLow!=after.nFileSizeLow ||
    CompareFileTime(&before.ftLastWriteTime,&after.ftLastWriteTime) || total!=after.nFileSizeLow)goto done;
  for(int i=0;i<32;i++)swprintf(actual+2*i,3,L"%02x",bytes[i]);actual[64]=0;
  if(wcscmp(actual,expected))goto done;
  ok=identity(h,id);
done:
  if(hash)BCryptDestroyHash(hash);if(alg)BCryptCloseAlgorithmProvider(alg,0);free(object);return ok;
}
static int rename_handle(HANDLE source,HANDLE parent,const WCHAR *target) {
  if(!segment(target))return 0;
  size_t size=offsetof(RENAME_INFO,name)+wcslen(target)*sizeof(WCHAR);
  if(size>65535)return 0;
  RENAME_INFO *info=(RENAME_INFO *)calloc(1,size);if(!info)return 0;
  info->replace=FALSE;info->parent=parent;info->length=(ULONG)(wcslen(target)*sizeof(WCHAR));
  memcpy(info->name,target,info->length);IO_STATUS_BLOCK io;
  NTSTATUS status=nt_set(source,&io,info,(ULONG)size,10); /* FileRenameInformation */
  free(info);return status>=0;
}
static int delete_handle(HANDLE h) {
  FILE_DISPOSITION_INFO disposition;disposition.DeleteFile=TRUE;
  return SetFileInformationByHandle(h,FileDispositionInfo,&disposition,sizeof(disposition))!=0;
}
/* Named root and mutation gates use the physical local NTFS file ID. A new
 * root lease probes the mutation gate, closing abandoned-lease/orphan races. */
static HANDLE gate(IDENTITY id,const WCHAR *kind) {
  WCHAR name[128];swprintf(name,128,L"Global\\ChatHarness-v1-%lu-%llu-%ls",id.volume,id.index,kind);
  return CreateMutexW(NULL,FALSE,name);
}
static int take(HANDLE h,DWORD timeout) {
  if(!h)return 0;DWORD r=WaitForSingleObject(h,timeout);return r==WAIT_OBJECT_0 || r==WAIT_ABANDONED;
}
static int alive(DWORD pid) {
  HANDLE h=OpenProcess(SYNCHRONIZE,FALSE,pid);if(!h)return 0;
  int result=WaitForSingleObject(h,0)==WAIT_TIMEOUT;CloseHandle(h);return result;
}
static DWORD parent_pid(void) {
  HANDLE snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);if(snapshot==INVALID_HANDLE_VALUE)return 0;
  PROCESSENTRY32W p;memset(&p,0,sizeof(p));p.dwSize=sizeof(p);DWORD result=0;
  if(Process32FirstW(snapshot,&p))do{if(p.th32ProcessID==GetCurrentProcessId()){result=p.th32ParentProcessID;break;}}while(Process32NextW(snapshot,&p));
  CloseHandle(snapshot);return result;
}
static int register_mutation(const WCHAR *root) {
  HANDLE dir=anchored(root,L".");IDENTITY id;
  if(dir==INVALID_HANDLE_VALUE || !identity(dir,&id))return 0;
  mutation_gate=gate(id,L"mutation");
  if(!take(mutation_gate,0))return 0;
  if(parent_pid()!=owner_pid || !alive(owner_pid) || !lease_pid || !alive(lease_pid))return 0;
  if(guarded_temp){HANDLE temp=anchored(root,L".chat-harness/temp");IDENTITY current;
    if(temp==INVALID_HANDLE_VALUE || !identity(temp,&current) || !same_id(current,temp_expected))return 0;}
  return 1;
}
static int lease(const WCHAR *root) {
  HANDLE dir=anchored(root,L".");IDENTITY id;
  if(dir==INVALID_HANDLE_VALUE || !identity(dir,&id))return 2;
  HANDLE exclusion=gate(id,L"root"),mutation=gate(id,L"mutation");
  if(!take(exclusion,0)){if(exclusion)CloseHandle(exclusion);if(mutation)CloseHandle(mutation);return 4;}
  if(!take(mutation,0)){ReleaseMutex(exclusion);CloseHandle(exclusion);if(mutation)CloseHandle(mutation);return 4;}
  ReleaseMutex(mutation);
  printf("locked %lu:%llu\n",id.volume,id.index);fflush(stdout);
  char command[16];int result=0;
  while(fgets(command,sizeof(command),stdin)) {
    if(strcmp(command,"pin\n")){result=64;break;}
    HANDLE temp=anchored(root,L".chat-harness/temp");IDENTITY current;
    if(temp==INVALID_HANDLE_VALUE || !identity(temp,&current)){result=5;break;}
    printf("pinned %lu:%llu\n",current.volume,current.index);fflush(stdout);
  }
  /* EOF may follow termination of only the CLI. Drain its already registered
   * native operation before permitting another executor/recoverer. */
  if(take(mutation,INFINITE))ReleaseMutex(mutation);else result=5;
  ReleaseMutex(exclusion);CloseHandle(exclusion);CloseHandle(mutation);return result;
}

#ifdef GATE0_TEST_HOOKS
static void boundary(const char *kind,const WCHAR *leaf) {
  const char *expected=getenv("GATE0_TEST_BOUNDARY");if(!expected)return;
  char name[1024];if(!WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,leaf,-1,name,sizeof(name),NULL,NULL))return;
  char actual[1200];snprintf(actual,sizeof(actual),"%s:%s",kind,name);
  if(strncmp(actual,expected,strlen(expected)))return;
  const char *signal=getenv("GATE0_TEST_BOUNDARY_SIGNAL");if(!signal)return;
  FILE *file=fopen(signal,"wb");if(!file)return;
  fprintf(file,"%s\n%lu\n",actual,GetCurrentProcessId());fclose(file);Sleep(2000);
}
#else
static void boundary(const char *kind,const WCHAR *leaf) {(void)kind;(void)leaf;}
#endif
static int stage(const WCHAR *root,const WCHAR *parent,const WCHAR *leaf,const WCHAR *digest) {
  if(!segment(leaf) || !digest_valid(digest))return 64;
  HANDLE dir=anchored(root,parent);if(dir==INVALID_HANDLE_VALUE)return 2;
  HANDLE h=relative_open(dir,leaf,FILE_READ_DATA|FILE_WRITE_DATA|FILE_READ_ATTRIBUTES,0,1);
  if(h==INVALID_HANDLE_VALUE)return 4;
  boundary("stage-open",leaf);unsigned char block[8192];size_t total=0;int ok=1;
  for(;;){size_t n=fread(block,1,sizeof(block),stdin);if(!n){if(ferror(stdin))ok=0;break;}
    total+=n;if(total>16*1024*1024){ok=0;break;}
    DWORD written=0;if(!WriteFile(h,block,(DWORD)n,&written,NULL) || written!=(DWORD)n){ok=0;break;}}
  IDENTITY id;if(ok)ok=FlushFileBuffers(h) && hash_handle(h,digest,&id);
  CloseHandle(h);if(ok)boundary("staged",leaf);return ok?0:5;
}
static int move(const WCHAR *root,const WCHAR *parent,const WCHAR *source,const WCHAR *target,const WCHAR *digest) {
  if(!segment(source) || !segment(target) || !wcscmp(source,target) || !digest_valid(digest))return 64;
  HANDLE dir=anchored(root,parent);if(dir==INVALID_HANDLE_VALUE)return 2;
  HANDLE h=relative_open(dir,source,FILE_READ_DATA|FILE_READ_ATTRIBUTES|DELETE,0,0);
  if(h==INVALID_HANDLE_VALUE)return 3;
  IDENTITY before,after;int ok=hash_handle(h,digest,&before);
  if(ok){boundary("pre-move",source);ok=rename_handle(h,dir,target);}
  if(ok){boundary("moved",target);ok=hash_handle(h,digest,&after) && same_id(before,after);}
  CloseHandle(h);return ok?0:5;
}
static int directory(const WCHAR *root,const WCHAR *parent,const WCHAR *leaf,int create) {
  HANDLE dir=anchored(root,parent);if(dir==INVALID_HANDLE_VALUE)return 2;
  HANDLE h=relative_open(dir,leaf,FILE_LIST_DIRECTORY|FILE_READ_ATTRIBUTES|(create?0:DELETE),1,create);
  if(h==INVALID_HANDLE_VALUE)return 4;
  int ok=create || delete_handle(h);CloseHandle(h);return ok?0:5;
}
static int verify(const WCHAR *root,const WCHAR *parent,const WCHAR *leaf,const WCHAR *digest,int discard) {
  if(!digest_valid(digest))return 64;
  HANDLE dir=anchored(root,parent);if(dir==INVALID_HANDLE_VALUE)return 2;
  HANDLE h=relative_open(dir,leaf,FILE_READ_DATA|FILE_READ_ATTRIBUTES|(discard?DELETE:0),0,0);
  if(h==INVALID_HANDLE_VALUE)return 3;
  IDENTITY id;int ok=hash_handle(h,digest,&id);
  if(ok && discard)ok=delete_handle(h);CloseHandle(h);
  if(ok && discard)boundary("discarded",leaf);return ok?0:5;
}
static int retire(const WCHAR *root) {
  HANDLE dir=anchored(root,L".chat-harness/temp");if(dir==INVALID_HANDLE_VALUE)return 2;
  HANDLE h=relative_open(dir,L"reconcile",FILE_LIST_DIRECTORY|FILE_READ_ATTRIBUTES|DELETE,1,0);
  if(h==INVALID_HANDLE_VALUE)return 3;
  IDENTITY before,after;int ok=identity(h,&before) && rename_handle(h,dir,L"reconcile-cleanup") &&
    identity(h,&after) && same_id(before,after);
  CloseHandle(h);if(ok)boundary("retired",L"reconcile");return ok?0:5;
}
static int parse_identity(const WCHAR *s,IDENTITY *id) {
  WCHAR tail;unsigned long volume;unsigned long long index;
  if(swscanf(s,L"%lu:%llu%lc",&volume,&index,&tail)!=2 || *s==L'-' || *s==L'+')return 0;
  id->volume=(DWORD)volume;id->index=index;return 1;
}
static int run(int argc,WCHAR **argv) {
  union { FARPROC raw; CREATE_FN create; SET_FN set; } fn;
  HMODULE library=GetModuleHandleW(L"ntdll.dll");if(!library)return 64;
  fn.raw=GetProcAddress(library,"NtCreateFile");nt_create=fn.create;
  fn.raw=GetProcAddress(library,"NtSetInformationFile");nt_set=fn.set;
  if(!nt_create || !nt_set)return 64;
  while(argc>2) {
    const WCHAR *s=argv[argc-1];WCHAR tail;
    if(!wcsncmp(s,L"--root-identity=",16)){if(!parse_identity(s+16,&root_expected))return 64;guarded_root=1;}
    else if(!wcsncmp(s,L"--temp-identity=",16)){if(!parse_identity(s+16,&temp_expected))return 64;guarded_temp=1;}
    else if(!wcsncmp(s,L"--owner-pid=",12)){if(swscanf(s+12,L"%lu%lc",&owner_pid,&tail)!=1 || !owner_pid)return 64;}
    else if(!wcsncmp(s,L"--lease-pid=",12)){if(swscanf(s+12,L"%lu%lc",&lease_pid,&tail)!=1 || !lease_pid)return 64;}
    else break;--argc;
  }
  if(argc==2 && !wcscmp(argv[1],L"--probe")){fputs("chat-harness-native-helper/1 win32-x64\n",stdout);return 0;}
  if(argc>=3 && owner_pid && wcscmp(argv[1],L"lease") && !register_mutation(argv[2]))return 5;
  if(argc==3 && !wcscmp(argv[1],L"lease"))return lease(argv[2]);
  if(argc==3 && !wcscmp(argv[1],L"reserve"))return directory(argv[2],L".chat-harness/temp",L"reconcile",1);
  if(argc==3 && !wcscmp(argv[1],L"retire"))return retire(argv[2]);
  if(argc==5 && (!wcscmp(argv[1],L"mkdir") || !wcscmp(argv[1],L"rmdir")))return directory(argv[2],argv[3],argv[4],!wcscmp(argv[1],L"mkdir"));
  if(argc==6 && !wcscmp(argv[1],L"stage"))return stage(argv[2],argv[3],argv[4],argv[5]);
  if(argc==6 && (!wcscmp(argv[1],L"verify") || !wcscmp(argv[1],L"discard")))return verify(argv[2],argv[3],argv[4],argv[5],!wcscmp(argv[1],L"discard"));
  if(argc==7 && (!wcscmp(argv[1],L"move") || !wcscmp(argv[1],L"restore") || !wcscmp(argv[1],L"promote")))return move(argv[2],argv[3],argv[4],argv[5],argv[6]);
  return 64;
}
int wmain(int argc,WCHAR **argv) {
  _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);
  int result=run(argc,argv);
  if(mutation_gate){ReleaseMutex(mutation_gate);CloseHandle(mutation_gate);}
  while(held_count)CloseHandle(held[--held_count]);
  if(result)fprintf(stderr,"Windows native operation refused (exit %d, error %lu); preserve transaction evidence.\n",result,GetLastError());
  return result;
}
