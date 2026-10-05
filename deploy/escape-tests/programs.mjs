// =============================================================================
// The programs the escape tests submit to Piston (Python 3.10 and C++ for gcc 10).
//
// Each program's first line is a marker, `# CC:<scenario>` or `// CC:<scenario>`.
// The mock Piston uses it to know which scenario it is answering; real Piston
// ignores it. Probe programs print machine-readable lines (CCPROBE / CCENV, see
// lib.mjs) so the harness never has to guess from free text.
//
// The target lists come from lib.mjs, the same lists the evaluators and the
// mock use. Nothing here is destructive: the only attack that really consumes
// resources is meant to be stopped by Piston's limits, and the file probes only
// create a uniquely named empty file (and delete it) if a write is NOT blocked.
// =============================================================================
import { ALLOWED_PISTON_ENV_KEYS, FS_TARGETS, NET_TARGETS, HELLO_MARKER, OUTPUT_SURVIVED_MARKER, MEMORY_SURVIVED_MARKER, validateCanaryPaths } from './lib.mjs';

const json = (value) => JSON.stringify(value);
const cString = (value) => json(String(value)); // JSON string syntax is valid C++ for our plain ASCII values
const cArray = (values) => `{ ${[...values.map(cString), 'nullptr'].join(', ')} }`;

// -----------------------------------------------------------------------------
// Python
// -----------------------------------------------------------------------------

const PY_PROBE_HELPERS = String.raw`
import os, sys

def emit(pid, verdict, detail=""):
    detail = str(detail).replace("\t", " ").replace("\r", " ").replace("\n", " ")[:200]
    sys.stdout.write("CCPROBE\t%s\t%s\t%s\n" % (pid, verdict, detail))
    sys.stdout.flush()

def errinfo(e):
    return "%s errno=%s" % (type(e).__name__, getattr(e, "errno", None))

def guard(pid, fn, *args):
    try:
        fn(pid, *args)
    except BaseException as e:
        emit(pid, "ERROR", "probe crashed: " + errinfo(e))
`;

function pythonFileAccess(canaryPaths) {
  return String.raw`# CC:file-access
${PY_PROBE_HELPERS}
READ_TARGETS = ${json(FS_TARGETS.read)}
CANARY_PATHS = ${json(canaryPaths)}
STAT_TARGETS = ${json(FS_TARGETS.stat)}
LIST_TARGETS = ${json(FS_TARGETS.list.map((l) => l.path))}
FOREIGN_ROOT = ${json(FS_TARGETS.foreignRoot)}
WRITE_TARGETS = ${json(FS_TARGETS.write)}
CONTROL_READ = ${json(FS_TARGETS.controlRead)}
ALLOWED_PISTON_ENV = ${json(ALLOWED_PISTON_ENV_KEYS)}

def probe_read(pid, path, show=False):
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError as e:
        emit(pid, "BLOCKED", errinfo(e))
        return
    try:
        data = os.read(fd, 64)
        detail = "opened and read %d bytes" % len(data)
        if show:
            detail += " content=" + data.decode("utf-8", "replace")
    except OSError as e:
        detail = "opened (read failed: %s)" % errinfo(e)
    finally:
        os.close(fd)
    emit(pid, "ALLOWED", detail)

def probe_stat(pid, path):
    try:
        os.stat(path)
    except OSError as e:
        emit(pid, "BLOCKED", errinfo(e))
        return
    emit(pid, "ALLOWED", "visible inside the sandbox")

def probe_list(pid, path):
    try:
        names = os.listdir(path)
    except OSError as e:
        emit(pid, "BLOCKED", errinfo(e))
        return
    emit(pid, "ALLOWED", "entries=%d" % len(names))

def probe_foreign_root(pid, path):
    # Can the job walk into somebody else's root directory? Reaching its own
    # (PID 1 may be the sandbox's own init) is harmless.
    try:
        theirs = os.stat(path)
    except OSError as e:
        emit(pid, "BLOCKED", errinfo(e))
        return
    mine = os.stat("/")
    if (theirs.st_dev, theirs.st_ino) == (mine.st_dev, mine.st_ino):
        emit(pid, "BLOCKED", "same directory as this job's own root")
    else:
        emit(pid, "ALLOWED", "a different root directory is reachable")

def probe_write(pid, dirpath):
    target = os.path.join(dirpath, ".cc-escape-probe-%d" % os.getpid())
    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except OSError as e:
        emit(pid, "BLOCKED", errinfo(e))
        return
    os.close(fd)
    try:
        os.unlink(target)
    except OSError:
        pass
    emit(pid, "ALLOWED", "created a file in " + dirpath)

def probe_proc_environ_scan(pid):
    try:
        pids = [n for n in os.listdir("/proc") if n.isdigit()]
    except OSError as e:
        emit(pid, "BLOCKED", errinfo(e))
        return
    leaked = []
    for n in pids:
        try:
            with open("/proc/%s/environ" % n, "rb") as f:
                data = f.read(65536)
        except OSError:
            continue
        for item in data.split(b"\0"):
            key = item.split(b"=", 1)[0].decode("ascii", "replace")
            if key.startswith("CANARY_") or (key.startswith("PISTON_") and key not in ALLOWED_PISTON_ENV):
                leaked.append("pid %s %s" % (n, key))
    if leaked:
        emit(pid, "ALLOWED", "readable: " + ", ".join(leaked[:5]))
    else:
        emit(pid, "BLOCKED", "no foreign PISTON_/CANARY_ variables readable in %d pids" % len(pids))

for p in READ_TARGETS:
    guard("read:" + p, probe_read, p, False)
for p in CANARY_PATHS:
    guard("read:" + p, probe_read, p, True)
for p in STAT_TARGETS:
    guard("stat:" + p, probe_stat, p)
for p in LIST_TARGETS:
    guard("list:" + p, probe_list, p)
guard("root:" + FOREIGN_ROOT, probe_foreign_root, FOREIGN_ROOT)
for p in WRITE_TARGETS:
    guard("write:" + p, probe_write, p)
guard("scan:/proc/*/environ", probe_proc_environ_scan)
guard("control:read:" + CONTROL_READ, probe_read, CONTROL_READ, False)
guard("control:write:cwd", probe_write, os.getcwd())
`;
}

function pythonNetwork() {
  const tcp = NET_TARGETS.tcp.map((t) => [t.host, t.port]);
  return String.raw`# CC:network
${PY_PROBE_HELPERS}
import socket, urllib.request, urllib.error

TCP_TARGETS = ${json(tcp)}
DNS_TARGET = ${json(NET_TARGETS.dns)}
HTTP_URL = ${json(NET_TARGETS.metadata.url)}
HTTP_ID = ${json(`http:${NET_TARGETS.metadata.host}`)}

def probe_tcp(pid, host, port):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    except BaseException as e:
        emit(pid, "BLOCKED", "phase=socket " + errinfo(e))
        return
    try:
        s.settimeout(1.0)
        s.connect((host, port))
    except BaseException as e:
        emit(pid, "BLOCKED", "phase=connect " + errinfo(e))
    else:
        emit(pid, "ALLOWED", "phase=connect connected to %s:%d" % (host, port))
    finally:
        try:
            s.close()
        except BaseException:
            pass

def probe_dns(pid, host):
    try:
        infos = socket.getaddrinfo(host, 80)
    except BaseException as e:
        emit(pid, "BLOCKED", "phase=resolve " + type(e).__name__)
        return
    emit(pid, "ALLOWED", "phase=resolve resolved to " + str(infos[0][4][0]))

def probe_http(pid, url):
    try:
        r = urllib.request.urlopen(url, timeout=1.5)
    except urllib.error.HTTPError as e:
        # An HTTP error status still means a server answered: the network is reachable.
        emit(pid, "ALLOWED", "phase=http server answered HTTP %s" % e.code)
    except BaseException as e:
        reason = getattr(e, "reason", e)
        emit(pid, "BLOCKED", "phase=http %s (%s)" % (type(e).__name__, type(reason).__name__))
    else:
        emit(pid, "ALLOWED", "phase=http HTTP %s" % r.status)

for host, port in TCP_TARGETS:
    guard("tcp:%s:%d" % (host, port), probe_tcp, host, port)
guard(HTTP_ID, probe_http, HTTP_URL)
guard("dns:" + DNS_TARGET, probe_dns, DNS_TARGET)
`;
}

const PYTHON = {
  sanity: () => `# CC:sanity\nprint("${HELLO_MARKER}")\n`,
  'infinite-loop': () => '# CC:infinite-loop\nwhile True:\n    pass\n',
  'fork-bomb': () => '# CC:fork-bomb\nimport os\nwhile True:\n    os.fork()\n',
  'huge-output': () => `# CC:huge-output
import sys
line = "A" * 1023 + "\\n"
for _ in range(100000):  # about 100 MB if nothing stops it
    sys.stdout.write(line)
sys.stdout.flush()
print("${OUTPUT_SURVIVED_MARKER}")
`,
  // Same flood on stderr. The marker goes to stdout, so seeing it still means "ran to the end".
  'huge-stderr': () => `# CC:huge-stderr
import sys
line = "E" * 1023 + "\\n"
for _ in range(100000):  # about 100 MB if nothing stops it
    sys.stderr.write(line)
sys.stderr.flush()
print("${OUTPUT_SURVIVED_MARKER}")
`,
  'env-leak': () => String.raw`# CC:env-leak
import os, sys
for key in sorted(os.environ):
    value = os.environ[key].replace("\t", " ").replace("\r", " ").replace("\n", " ")
    sys.stdout.write("CCENV\t%s\t%s\n" % (key, value[:200]))
`,
  'memory-bomb': () => `# CC:memory-bomb
blocks = []
for _ in range(128):  # 128 x 16 MiB = 2 GiB, every byte touched
    blocks.append(b"x" * (16 * 1024 * 1024))
print("${MEMORY_SURVIVED_MARKER}")
`,
  'file-access': (opts) => pythonFileAccess(opts.canaryPaths),
  network: () => pythonNetwork(),
};

// -----------------------------------------------------------------------------
// C++ (gcc 10; nothing newer than C++11 is used)
// -----------------------------------------------------------------------------

const CPP_PROBE_HELPERS = String.raw`
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <unistd.h>

static void emit(const char* id, const char* verdict, const char* detail) {
    std::printf("CCPROBE\t%s\t%s\t%s\n", id, verdict, detail);
    std::fflush(stdout);
}

static void emit_errno(const char* id, const char* phase, int e) {
    char detail[240];
    std::snprintf(detail, sizeof detail, "%serrno=%d %s", phase, e, std::strerror(e));
    emit(id, "BLOCKED", detail);
}
`;

function cppFileAccess(canaryPaths) {
  return String.raw`// CC:file-access
${CPP_PROBE_HELPERS}
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>

static const char* READ_TARGETS[] = ${cArray(FS_TARGETS.read)};
static const char* CANARY_PATHS[] = ${cArray(canaryPaths)};
static const char* STAT_TARGETS[] = ${cArray(FS_TARGETS.stat)};
static const char* LIST_TARGETS[] = ${cArray(FS_TARGETS.list.map((l) => l.path))};
static const char* FOREIGN_ROOT = ${cString(FS_TARGETS.foreignRoot)};
static const char* WRITE_TARGETS[] = ${cArray(FS_TARGETS.write)};
static const char* CONTROL_READ = ${cString(FS_TARGETS.controlRead)};
static const char* ALLOWED_PISTON_ENV[] = ${cArray(ALLOWED_PISTON_ENV_KEYS)};

static void probe_read(const char* id, const char* path, bool show) {
    int fd = open(path, O_RDONLY);
    if (fd < 0) { emit_errno(id, "", errno); return; }
    char data[65];
    std::memset(data, 0, sizeof data);
    ssize_t n = read(fd, data, 64);
    close(fd);
    for (ssize_t i = 0; i < n; i++) {
        if (data[i] == '\t' || data[i] == '\r' || data[i] == '\n') data[i] = ' ';
    }
    char detail[300];
    if (show && n > 0) std::snprintf(detail, sizeof detail, "opened and read %d bytes content=%s", (int)n, data);
    else std::snprintf(detail, sizeof detail, "opened and read %d bytes", (int)n);
    emit(id, "ALLOWED", detail);
}

static void probe_stat(const char* id, const char* path) {
    struct stat st;
    if (stat(path, &st) != 0) { emit_errno(id, "", errno); return; }
    emit(id, "ALLOWED", "visible inside the sandbox");
}

static void probe_list(const char* id, const char* path) {
    DIR* d = opendir(path);
    if (!d) { emit_errno(id, "", errno); return; }
    int entries = 0;
    while (struct dirent* e = readdir(d)) {
        if (std::strcmp(e->d_name, ".") != 0 && std::strcmp(e->d_name, "..") != 0) entries++;
    }
    closedir(d);
    char detail[64];
    std::snprintf(detail, sizeof detail, "entries=%d", entries);
    emit(id, "ALLOWED", detail);
}

// Can the job walk into somebody else's root directory? Reaching its own (PID 1
// may be the sandbox's own init) is harmless.
static void probe_foreign_root(const char* id, const char* path) {
    struct stat theirs, mine;
    if (stat(path, &theirs) != 0) { emit_errno(id, "", errno); return; }
    if (stat("/", &mine) != 0) { emit_errno(id, "", errno); return; }
    if (theirs.st_dev == mine.st_dev && theirs.st_ino == mine.st_ino) emit(id, "BLOCKED", "same directory as this job's own root");
    else emit(id, "ALLOWED", "a different root directory is reachable");
}

static bool is_number(const char* s) {
    if (!*s) return false;
    for (; *s; s++) {
        if (*s < '0' || *s > '9') return false;
    }
    return true;
}

// CANARY_* is never allowed; PISTON_* only when it is on the allowed list.
static bool foreign_key(const char* key, size_t len) {
    if (len >= 7 && std::strncmp(key, "CANARY_", 7) == 0) return true;
    if (len < 7 || std::strncmp(key, "PISTON_", 7) != 0) return false;
    for (int i = 0; ALLOWED_PISTON_ENV[i]; i++) {
        if (std::strlen(ALLOWED_PISTON_ENV[i]) == len && std::strncmp(ALLOWED_PISTON_ENV[i], key, len) == 0) return false;
    }
    return true;
}

// Reads every /proc/<pid>/environ the job is allowed to read and reports a
// PISTON_ or CANARY_ variable that is not meant to be visible to jobs.
static void probe_environ_scan(const char* id) {
    DIR* d = opendir("/proc");
    if (!d) { emit_errno(id, "", errno); return; }
    static char buf[65536];
    int pids = 0;
    int leaked = 0;
    char first[400];
    first[0] = 0;
    while (struct dirent* e = readdir(d)) {
        if (!is_number(e->d_name)) continue;
        pids++;
        char path[300];  // "/proc/" + a directory name of up to 255 characters + "/environ"
        std::snprintf(path, sizeof path, "/proc/%s/environ", e->d_name);
        int fd = open(path, O_RDONLY);
        if (fd < 0) continue;
        ssize_t n = read(fd, buf, sizeof buf - 1);
        close(fd);
        if (n <= 0) continue;
        buf[n] = 0;
        for (ssize_t pos = 0; pos < n;) {
            const char* item = buf + pos;
            size_t len = std::strlen(item);
            const char* eq = static_cast<const char*>(std::memchr(item, '=', len));
            size_t key_len = eq ? static_cast<size_t>(eq - item) : len;
            if (foreign_key(item, key_len)) {
                leaked++;
                if (!first[0]) {
                    char key[101];
                    size_t shown = key_len > 100 ? 100 : key_len;
                    std::memcpy(key, item, shown);
                    key[shown] = 0;
                    std::snprintf(first, sizeof first, "pid %s %s", e->d_name, key);
                }
            }
            pos += static_cast<ssize_t>(len) + 1;
        }
    }
    closedir(d);
    char detail[500];
    if (leaked > 0) {
        std::snprintf(detail, sizeof detail, "readable: %s (%d variable(s) in total)", first, leaked);
        emit(id, "ALLOWED", detail);
    } else {
        std::snprintf(detail, sizeof detail, "no foreign PISTON_/CANARY_ variables readable in %d pids", pids);
        emit(id, "BLOCKED", detail);
    }
}

static void probe_write(const char* id, const char* dir) {
    char target[700];
    const char* sep = (std::strcmp(dir, "/") == 0) ? "" : "/";
    std::snprintf(target, sizeof target, "%s%s.cc-escape-probe-%d", dir, sep, (int)getpid());
    int fd = open(target, O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (fd < 0) { emit_errno(id, "", errno); return; }
    close(fd);
    unlink(target);
    char detail[300];
    std::snprintf(detail, sizeof detail, "created a file in %s", dir);
    emit(id, "ALLOWED", detail);
}

int main() {
    char id[700];
    for (int i = 0; READ_TARGETS[i]; i++) { std::snprintf(id, sizeof id, "read:%s", READ_TARGETS[i]); probe_read(id, READ_TARGETS[i], false); }
    for (int i = 0; CANARY_PATHS[i]; i++) { std::snprintf(id, sizeof id, "read:%s", CANARY_PATHS[i]); probe_read(id, CANARY_PATHS[i], true); }
    for (int i = 0; STAT_TARGETS[i]; i++) { std::snprintf(id, sizeof id, "stat:%s", STAT_TARGETS[i]); probe_stat(id, STAT_TARGETS[i]); }
    for (int i = 0; LIST_TARGETS[i]; i++) { std::snprintf(id, sizeof id, "list:%s", LIST_TARGETS[i]); probe_list(id, LIST_TARGETS[i]); }
    std::snprintf(id, sizeof id, "root:%s", FOREIGN_ROOT);
    probe_foreign_root(id, FOREIGN_ROOT);
    for (int i = 0; WRITE_TARGETS[i]; i++) { std::snprintf(id, sizeof id, "write:%s", WRITE_TARGETS[i]); probe_write(id, WRITE_TARGETS[i]); }
    probe_environ_scan("scan:/proc/*/environ");
    std::snprintf(id, sizeof id, "control:read:%s", CONTROL_READ);
    probe_read(id, CONTROL_READ, false);
    char cwd[512];
    if (getcwd(cwd, sizeof cwd)) probe_write("control:write:cwd", cwd);
    else emit("control:write:cwd", "ERROR", "getcwd failed");
    return 0;
}
`;
}

function cppNetwork() {
  const tcp = [...NET_TARGETS.tcp, { host: NET_TARGETS.metadata.host, port: NET_TARGETS.metadata.port }];
  const hosts = tcp.map((t) => `{ ${cString(t.host)}, ${t.port} }`).join(', ');
  return String.raw`// CC:network
${CPP_PROBE_HELPERS}
#include <arpa/inet.h>
#include <netdb.h>
#include <sys/socket.h>
#include <sys/time.h>

struct Target { const char* host; int port; };
static const Target TCP_TARGETS[] = { ${hosts} };
static const char* DNS_TARGET = ${cString(NET_TARGETS.dns)};

static void probe_tcp(const char* host, int port) {
    char id[128];
    char detail[240];
    std::snprintf(id, sizeof id, "tcp:%s:%d", host, port);
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) { emit_errno(id, "phase=socket ", errno); return; }
    struct timeval tv;
    tv.tv_sec = 1;
    tv.tv_usec = 0;
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
    struct sockaddr_in addr;
    std::memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_port = htons((unsigned short)port);
    inet_pton(AF_INET, host, &addr.sin_addr);
    if (connect(fd, (struct sockaddr*)&addr, sizeof addr) == 0) {
        std::snprintf(detail, sizeof detail, "phase=connect connected to %s:%d", host, port);
        emit(id, "ALLOWED", detail);
    } else {
        emit_errno(id, "phase=connect ", errno);
    }
    close(fd);
}

static void probe_dns(const char* host) {
    char id[128];
    char detail[240];
    std::snprintf(id, sizeof id, "dns:%s", host);
    struct addrinfo hints;
    std::memset(&hints, 0, sizeof hints);
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    struct addrinfo* res = nullptr;
    int rc = getaddrinfo(host, "80", &hints, &res);
    if (rc != 0) {
        std::snprintf(detail, sizeof detail, "phase=resolve %s", gai_strerror(rc));
        emit(id, "BLOCKED", detail);
        return;
    }
    freeaddrinfo(res);
    emit(id, "ALLOWED", "phase=resolve resolved");
}

int main() {
    for (unsigned i = 0; i < sizeof TCP_TARGETS / sizeof TCP_TARGETS[0]; i++) probe_tcp(TCP_TARGETS[i].host, TCP_TARGETS[i].port);
    probe_dns(DNS_TARGET);
    return 0;
}
`;
}

const CPP = {
  sanity: () => `// CC:sanity
#include <iostream>
int main() {
    std::cout << "${HELLO_MARKER}" << std::endl;
    return 0;
}
`,
  'infinite-loop': () => `// CC:infinite-loop
int main() {
    volatile unsigned long counter = 0;
    while (1) { counter = counter + 1; }
}
`,
  'fork-bomb': () => `// CC:fork-bomb
#include <unistd.h>
int main() {
    for (;;) fork();
}
`,
  'huge-output': () => `// CC:huge-output
#include <cstdio>
int main() {
    static char line[1025];
    for (int i = 0; i < 1023; i++) line[i] = 'A';
    line[1023] = '\\n';
    line[1024] = 0;
    for (int i = 0; i < 100000; i++) std::fputs(line, stdout);  // about 100 MB if nothing stops it
    std::fflush(stdout);
    std::puts("${OUTPUT_SURVIVED_MARKER}");
    return 0;
}
`,
  // Same flood on stderr. The marker goes to stdout, so seeing it still means "ran to the end".
  'huge-stderr': () => `// CC:huge-stderr
#include <cstdio>
int main() {
    static char line[1025];
    for (int i = 0; i < 1023; i++) line[i] = 'E';
    line[1023] = '\\n';
    line[1024] = 0;
    for (int i = 0; i < 100000; i++) std::fputs(line, stderr);  // about 100 MB if nothing stops it
    std::fflush(stderr);
    std::puts("${OUTPUT_SURVIVED_MARKER}");
    return 0;
}
`,
  'env-leak': () => String.raw`// CC:env-leak
#include <cstdio>
#include <cstring>
extern char** environ;
int main() {
    for (char** e = environ; e && *e; ++e) {
        const char* entry = *e;
        const char* eq = std::strchr(entry, '=');
        if (!eq) continue;
        std::printf("CCENV\t%.*s\t", (int)(eq - entry), entry);
        int shown = 0;
        for (const char* v = eq + 1; *v && shown < 200; ++v, ++shown) {
            char c = *v;
            std::putchar((c == '\t' || c == '\r' || c == '\n') ? ' ' : c);
        }
        std::putchar('\n');
    }
    return 0;
}
`,
  'memory-bomb': () => `// CC:memory-bomb
#include <cstdio>
#include <cstdlib>
#include <cstring>
// Keeping the pointers in a volatile global stops an optimizing compiler from
// deleting the allocation and the memset as dead code.
static char* volatile kept[128];
int main() {
    const size_t step = 16u * 1024u * 1024u;  // 128 x 16 MiB = 2 GiB, every byte touched
    for (int i = 0; i < 128; i++) {
        char* block = static_cast<char*>(std::malloc(step));
        if (!block) { std::puts("CC-MEM-ALLOC-FAILED"); return 3; }
        std::memset(block, 1, step);
        kept[i] = block;
    }
    std::puts("${MEMORY_SURVIVED_MARKER}");
    return 0;
}
`,
  'file-access': (opts) => cppFileAccess(opts.canaryPaths),
  network: () => cppNetwork(),
};

// -----------------------------------------------------------------------------

/** Scenarios that have a program of their own. (limit-raise reuses `sanity`.) */
export const PROGRAM_SCENARIOS = Object.freeze(Object.keys(PYTHON));

/** @returns {string} source code of the attack program for a scenario and language ('python' | 'cpp'). */
export function buildProgram(scenario, lang, { canaryPaths = [] } = {}) {
  const table = lang === 'python' ? PYTHON : lang === 'cpp' ? CPP : null;
  if (!table) throw new Error(`unknown language: ${lang}`);
  const make = table[scenario];
  if (!make) throw new Error(`no ${lang} program for scenario: ${scenario}`);
  return make({ canaryPaths: validateCanaryPaths(canaryPaths) });
}

/** The marker on the program's first line, as the mock reads it. */
export function scenarioOfSource(source) {
  const match = /^(?:#|\/\/) CC:([a-z-]+)/.exec(String(source));
  return match ? match[1] : null;
}
