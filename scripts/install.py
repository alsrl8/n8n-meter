#!/usr/bin/env python3
"""Attach to a simple existing Compose n8n without editing its configuration."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
COLLECTOR = 'n8nmeter'
GATEWAY = 'n8nmeter-gateway'


def step(number, message):
    print(f'[{number}/5] {message}', flush=True)


def command(args, label):
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    elapsed = 0
    while True:
        try:
            output, _ = process.communicate(timeout=8)
            break
        except subprocess.TimeoutExpired:
            elapsed += 8
            print(f'    {label} 진행 중 · {elapsed}초', flush=True)
        except KeyboardInterrupt:
            process.terminate()
            try: process.communicate(timeout=5)
            except subprocess.TimeoutExpired: process.kill(); process.communicate()
            raise
    if process.returncode:
        raise ValueError(f'{label} 실패 (exit {process.returncode}). 기존 DB 비밀값 보호를 위해 원본 명령 출력은 표시하지 않습니다.')
    return output


def discover(model, selected=None):
    services = model.get('services', {})
    candidates = [name for name, value in services.items() if re.search(r'(?:^|/)n8n(?::|@|$)', value.get('image', ''))]
    if selected:
        if selected not in candidates:
            raise ValueError('지정한 서비스가 n8n 이미지 서비스가 아닙니다.')
        candidates = [selected]
    if len(candidates) != 1:
        raise ValueError('단일 n8n 서비스를 자동 선택하지 못했습니다. --service 이름으로 지정하세요.')
    name = candidates[0]
    service = services[name]
    env = service.get('environment', {})
    if COLLECTOR in services or GATEWAY in services:
        raise ValueError('추가할 서비스 이름이 기존 Compose와 충돌합니다.')
    if service.get('network_mode') or service.get('profiles') or env.get('EXECUTIONS_MODE') == 'queue':
        raise ValueError('이번 간편 설치는 기본 네트워크의 단일 n8n만 지원합니다. queue/host-network/profile 구성은 수동 설치를 사용하세요.')
    if env.get('DB_TYPE') != 'postgresdb':
        raise ValueError('PostgreSQL n8n만 지원합니다. DB는 변경하지 않았습니다.')
    if env.get('N8N_PATH', '/') != '/' or env.get('N8N_PROTOCOL', 'http') != 'http':
        raise ValueError('간편 설치는 웹 루트(/)의 HTTP n8n만 지원합니다. TLS 종단/서브경로는 수동 검증이 필요합니다.')
    port = int(env.get('N8N_PORT', 5678))
    ports = service.get('ports', [])
    if len(ports) != 1 or ports[0].get('protocol', 'tcp') != 'tcp' or ports[0].get('target') != port or not str(ports[0].get('published', '')).isdigit():
        raise ValueError('고정 HTTP 공개 포트 하나가 있는 n8n만 지원합니다. Ingress/Traefik 전용 구성은 수동 설치를 사용하세요.')
    version = service['image'].rsplit(':', 1)[-1]
    if version != '2.26.9':
        raise ValueError('간편 설치 검증 버전은 n8n 2.26.9입니다. 실제 이미지 tag를 확인하세요. 다른 버전은 수동 호환성 검증 후 설치합니다.')
    if not env.get('DB_POSTGRESDB_HOST'):
        raise ValueError('DB 주소를 자동 확인하지 못했습니다. DB_POSTGRESDB_HOST 설정이 필요합니다.')
    return name, service, env, ports[0], version


def make_overlay(model, selected, secret, reader):
    name, service, env, port, version = discover(model, selected)
    networks = list(service.get('networks', {'default': {}}))
    upstream = f'http://{name}:{env.get("N8N_PORT", 5678)}'
    image_port = {key: value for key, value in port.items() if key in ['published', 'host_ip', 'protocol']}
    image_port['target'] = 8080
    collector = {
        'build': {'context': str(ROOT)}, 'image': 'n8n-meter:0.1.0', 'restart': 'unless-stopped',
        'environment': {
            'N8N_METER_SOURCE_ID': model['name'] + ':' + name,
            'N8N_METER_SOURCE_LABEL': 'n8n', 'N8N_VERSION': version,
            'N8N_METER_N8N_UPSTREAM': upstream,
            'PGHOST': env['DB_POSTGRESDB_HOST'], 'PGPORT': str(env.get('DB_POSTGRESDB_PORT', 5432)),
            'PGDATABASE': env.get('DB_POSTGRESDB_DATABASE', 'n8n'), 'PGUSER': reader,
            'PGSCHEMA': env.get('DB_POSTGRESDB_SCHEMA', 'public'),
            'N8N_TABLE_PREFIX': env.get('DB_TABLE_PREFIX', ''), 'PGPASSWORD_FILE': '/run/secrets/n8nmeter_reader',
        },
        'secrets': ['n8nmeter_reader'], 'volumes': ['n8nmeter_data:/data'], 'networks': networks,
        'read_only': True, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
        'healthcheck': {'test': ['CMD', 'node', '-e', "fetch('http://127.0.0.1:7810/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], 'interval': '5s', 'timeout': '5s', 'retries': 12},
    }
    if env.get('DB_POSTGRESDB_SSL_ENABLED') in ['true', True]:
        raise ValueError('DB TLS 구성은 CA 파일 연결이 필요합니다. 현재 간편 설치는 같은 Docker 네트워크의 비TLS DB만 지원합니다.')
    gateway = {
        'build': {'context': str(ROOT), 'dockerfile': 'gateway/Dockerfile'},
        'image': 'n8n-meter-gateway:0.1.0', 'restart': 'unless-stopped', 'ports': [image_port],
        'environment': {'N8N_UPSTREAM': upstream, 'N8N_METER_UPSTREAM': f'http://{COLLECTOR}:7810'},
        'networks': networks,
        'healthcheck': {'test': ['CMD', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:8080/healthz'], 'interval': '5s', 'timeout': '5s', 'retries': 24},
    }
    # JSON values are valid YAML. !override prevents Compose appending the old binding.
    overlay = 'services:\n  ' + json.dumps(name) + ':\n    ports: !override []\n'
    for key, value in [(COLLECTOR, collector), (GATEWAY, gateway)]:
        overlay += '  ' + key + ': ' + json.dumps(value) + '\n'
    overlay += 'volumes:\n  n8nmeter_data: {}\nsecrets:\n  n8nmeter_reader: ' + json.dumps({'file': str(secret)}) + '\n'
    return name, port, overlay


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description='기존 주소·기존 로그인 그대로 n8n에 사용량 버튼을 추가합니다.')
    parser.add_argument('compose', type=Path, help='기존 n8n Compose 파일')
    parser.add_argument('--service', help='n8n 서비스명 (자동 감지)')
    parser.add_argument('--reader-secret', type=Path, help='기존 읽기 계정 비밀번호 파일 (비밀번호 자체가 아님)')
    parser.add_argument('--reader-user', default='n8nmeter_reader')
    parser.add_argument('--check', action='store_true', help='계획/설정 검증만 수행')
    parser.add_argument('--yes', action='store_true', help='표시된 설치 계획을 적용')
    parser.add_argument('--status', action='store_true')
    parser.add_argument('--remove', action='store_true', help='추가 구성만 제거하고 원래 포트 복구; 데이터 보존')
    args = parser.parse_args()
    path = args.compose.expanduser().resolve(strict=True)
    digest = hashlib.sha256(str(path).encode()).hexdigest()[:12]
    folder = ROOT / '.local' / ('install-' + digest)
    statefile = folder / 'state.json'
    override = folder / 'compose.meter.yaml'
    base = ['docker', 'compose', '--project-directory', str(path.parent), '-f', str(path)]
    if args.status or args.remove:
        if not statefile.exists():
            raise ValueError('이 파일에 대해 준비한 설치 기록이 없습니다.')
        state = json.loads(statefile.read_text())
        if hashlib.sha256(path.read_bytes()).hexdigest() != state['hash']:
            raise ValueError('기존 Compose 파일이 변경됐습니다. 기록된 구성을 검토한 뒤 수동 복구하세요.')
        combined = base + ['-p', state['project'], '-f', str(override)]
        if args.status:
            print(command(combined + ['ps', state['service'], COLLECTOR, GATEWAY], '상태 확인'))
            return
        print('추가 서비스만 제거하고 n8n의 원래 포트를 복구합니다. n8n은 잠시 재시작됩니다. 데이터 볼륨은 보존합니다.')
        if not args.yes and input('진행할까요? [y/N] ').strip().lower() != 'y': return
        command(combined + ['rm', '-s', '-f', GATEWAY, COLLECTOR], '추가 서비스 제거')
        command(base + ['-p', state['project'], 'up', '-d', '--no-deps', state['service']], '기존 n8n 복구')
        print('복구 완료. 원래 n8n 주소를 사용하세요. 통계 볼륨과 설치 기록은 보존했습니다.')
        return
    step(1, '기존 n8n 구성 확인')
    version = command(['docker', 'compose', 'version', '--short'], 'Compose 버전 확인')
    numbers = tuple(int(x) for x in re.findall(r'\d+', version)[:3])
    if numbers < (2, 24, 4): raise ValueError('Docker Compose 2.24.4 이상이 필요합니다.')
    model = json.loads(command(base + ['config', '--format', 'json'], 'Compose 읽기'))
    name, _, env, port, _ = discover(model, args.service)
    step(2, f'n8n 서비스 {name} · 기존 포트 {port["published"]} 유지 · 기존 로그인 사용')
    print(f'  DB: {env["DB_POSTGRESDB_HOST"]} / {env.get("DB_POSTGRESDB_DATABASE", "n8n")} · 읽기 계정: {args.reader_user}')
    secret = args.reader_secret
    if not secret and sys.stdin.isatty():
        print('  읽기 전용 DB 계정의 기존 비밀번호 파일 경로만 입력하세요. 비밀번호는 출력하거나 복사하지 않습니다.')
        secret = Path(input('  파일 경로: ').strip())
    if not secret: raise ValueError('--reader-secret 파일이 필요합니다. 읽기 계정 준비 방법: docs/advanced-install.md')
    secret = secret.expanduser().resolve(strict=True)
    if not secret.is_file() or not secret.stat().st_size: raise ValueError('비밀번호 파일이 비어 있거나 파일이 아닙니다.')
    name, port, content = make_overlay(model, args.service, secret, args.reader_user)
    folder.mkdir(parents=True, exist_ok=True)
    if statefile.exists():
        state = json.loads(statefile.read_text())
        if state['hash'] != hashlib.sha256(path.read_bytes()).hexdigest():
            raise ValueError('기존 설치 이후 Compose 파일이 바뀌었습니다. 저장된 복구 정보를 먼저 검토하세요.')
    override.write_text(content)
    statefile.write_text(json.dumps({'hash': hashlib.sha256(path.read_bytes()).hexdigest(), 'project': model['name'], 'service': name}))
    combined = base + ['-p', model['name'], '-f', str(override)]
    command(combined + ['config', '--quiet'], '추가 설정 검증')
    print(f'  추가: 수집기 + 화면 연결기 (2개 컨테이너)\n  원본 Compose: 수정 없음\n  적용 계획: {override}\n  영향: n8n 포트 연결을 옮길 때 잠시 재시작\n  DB 계정/권한: 변경 없음')
    if args.check:
        print('확인 완료. 실행 중인 서비스는 변경하지 않았습니다. DB 접근은 적용 전 별도 검사합니다.')
        return
    if not args.yes and input('이 구성으로 적용할까요? [y/N] ').strip().lower() != 'y': return
    container = command(base + ['-p', model['name'], 'ps', '-q', name], '기존 n8n 실행 확인').strip()
    if not container:
        raise ValueError('기존 n8n이 실행 중이어야 합니다.')
    labels = json.loads(command(['docker', 'inspect', '--format', '{{json .Config.Labels}}', container], '실행 구성 확인'))
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    if not files or any(Path(f).resolve() not in [path, override] for f in files):
        raise ValueError('실행 중인 n8n은 다른 Compose 파일도 사용합니다. 단일 파일 간편 설치를 적용하지 않았습니다.')
    step(3, '필요한 이미지 준비와 읽기 전용 DB 접근 확인 (첫 빌드는 시간이 걸립니다)')
    command(combined + ['build', COLLECTOR, GATEWAY], '이미지 준비')
    command(combined + ['run', '--rm', '--no-deps', COLLECTOR, 'node', 'preflight.mjs'], 'DB 읽기 계정 사전 검사')
    step(4, '기존 주소에 연결 · n8n이 잠시 재시작됩니다')
    try:
        command(combined + ['up', '-d', '--no-deps', name], 'n8n 포트 전환')
        command(combined + ['up', '-d', '--no-deps', '--wait', '--wait-timeout', '120', COLLECTOR, GATEWAY], '추가 기능 시작')
    except (ValueError, KeyboardInterrupt):
        print('연결 실패. 원래 n8n 포트를 복구합니다.', flush=True)
        command(combined + ['rm', '-s', '-f', GATEWAY, COLLECTOR], '실패한 추가 서비스 정리')
        command(base + ['-p', model['name'], 'up', '-d', '--no-deps', name], '원래 n8n 복구')
        raise
    step(5, '설치 완료 · 기존 n8n 주소를 새로고침하세요')
    print('  관리자 로그인 → 워크플로 목록 → 사용량\n  추가 로그인/Chrome 확장 설치는 필요 없습니다.')
    print(f'  상태: ./install.sh {path} --status\n  되돌리기: ./install.sh {path} --remove')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, EOFError, KeyboardInterrupt) as error:
        print(f'중단: {error}', file=sys.stderr)
        sys.exit(1)
