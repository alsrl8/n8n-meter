# 고급 설치와 운영

기본 경로는 [README의 간편 설치](../README.md)입니다. 이 문서는 DB 계정 준비와 자동 설치 범위 밖의 구성을 설명합니다. 모든 명령은 저장소 루트에서 실행합니다.

## 읽기 계정 준비

기존 n8n 계정은 보통 쓰기 권한이 있습니다. 수집기는 이를 거부합니다. DB 관리자가 기존 Secret 관리 절차로 전용 LOGIN 계정과 비밀번호 파일을 준비하세요. 설치 도구는 DB 계정 생성·권한 변경을 하지 않습니다.

```sql
CREATE ROLE n8nmeter_reader LOGIN;
GRANT CONNECT ON DATABASE n8n TO n8nmeter_reader;
GRANT USAGE ON SCHEMA public TO n8nmeter_reader;
GRANT SELECT ON public.workflow_statistics,
  public.insights_raw, public.insights_by_period TO n8nmeter_reader;
```

DB명·스키마·테이블 prefix는 환경에 맞춥니다. 비밀번호 지정은 조직의 DB 관리 절차를 사용합니다. 파일에는 비밀번호 한 개만 넣고 Git에 추가하지 마세요. Linux에서는 수집기 UID 1000이 읽을 수 있는 소유권/ACL이 필요합니다. 수집은 단일 연결, READ ONLY 트랜잭션, 5초 쿼리 제한으로 진행합니다. 기존 계정명을 쓰려면 `./install.sh COMPOSE --reader-user 계정명 --reader-secret 파일`을 사용합니다.

## 간편 설치의 변경과 복구

- 원본 Compose는 수정하지 않습니다. 별도 override가 n8n의 기존 공개 포트를 화면 연결기로 옮깁니다. 내부 n8n 서비스 이름/포트와 DB 볼륨은 유지합니다.
- Docker Compose의 [`!override`](https://docs.docker.com/reference/compose-file/merge/) 때문에 2.24.4 이상이 필요합니다.
- 실행 중인 프로젝트가 추가 Compose 파일을 사용하면 적용을 중단합니다. 현재는 단일 파일만 자동 지원합니다.
- 추가 설정 검증·이미지 빌드·읽기 계정 검사 후에 n8n 포트를 전환합니다. 이때 잠시 재시작이 발생하므로 진행 중인 실행이 없는 시간에 적용하세요.
- 연결 실패 시 추가 컨테이너를 제거하고 원래 Compose의 n8n 서비스만 다시 시작합니다. Docker 장애로 복구도 실패하면 원본 Compose로 n8n 서비스를 재시작하세요.
- `--remove`는 추가 서비스만 제거하고 원래 포트를 복구합니다. 통계 볼륨과 설치 기록은 보존합니다. 원본 Compose가 변경됐다면 자동 복구를 중단하므로 저장된 override를 먼저 검토하세요.
- `--yes`는 출력한 설치/제거 계획의 비대화형 실행입니다. 자동화에서는 대상을 명시하세요.

## 별도 Compose — 기존 Ingress 앞에 연결하는 경우

```sh
./scripts/quick-start.sh compose init
# .local/compose.env 편집: N8N_UPSTREAM, N8N_NETWORK, DB reader/secret 경로
./scripts/quick-start.sh compose check
./scripts/quick-start.sh compose up
```

이 경로는 기존 포트를 자동 인계하지 않고 loopback 7812에 화면 연결기를 제공합니다. 기존 Ingress의 n8n backend를 연결기로 바꾸는 작업은 관리자가 수행합니다. 새 사용 계정은 필요하지 않으며 통계 요청은 기존 n8n 관리자 세션으로 인증합니다. DB TLS는 CA 파일을 마운트하고 `PGSSLROOTCERT`를 지정하세요. 인증서 검증을 끄지 마세요.

## Helm / Kubernetes

기존 n8n release와 별도로 설치합니다. 공개 이미지는 아직 없으므로 두 이미지를 조직의 registry에 빌드/게시해야 합니다.

```sh
docker build -t YOUR_REGISTRY/n8n-meter:0.1.0 .
docker build -f gateway/Dockerfile -t YOUR_REGISTRY/n8n-meter-gateway:0.1.0 .
docker push YOUR_REGISTRY/n8n-meter:0.1.0
docker push YOUR_REGISTRY/n8n-meter-gateway:0.1.0
./scripts/quick-start.sh helm init
# .local/values.yaml에서 이미지, gateway.n8nUpstream, DB와 reader Secret 참조 설정
./scripts/quick-start.sh helm check
N8N_METER_CONTEXT=your-context N8N_METER_NAMESPACE=n8n ./scripts/quick-start.sh helm up
```

`database.existingSecret`은 같은 namespace의 읽기 계정 Secret, `passwordKey`는 그 키입니다. 별도 인증 Secret은 필요 없습니다. CA는 `database.caSecret`/`caKey`, StorageClass는 `persistence.storageClassName`을 지정합니다. private registry 인증은 기존 ServiceAccount imagePullSecrets 절차를 사용합니다.

Service는 `n8nmeter:8080`입니다(기본 release 이름). 기존 주소를 유지하려면 기존 Ingress의 backend를 이 Service로 연결합니다. chart는 기존 Ingress·n8n release를 수정하지 않습니다. TLS, 외부 forwarded headers, WebSocket, SSO callback과 webhook 동작을 먼저 검증하세요.

Helm release 없이 관리하려면 `./scripts/quick-start.sh k8s init`, `k8s render`, `k8s up`을 사용합니다. 로컬 Helm CLI가 YAML을 생성하고 `up`이 server dry-run 후 apply합니다. 같은 이름으로 Helm/kubectl 관리를 혼용하지 마세요.

## 보안과 데이터

통계 API는 n8n 2.26.9 `GET /rest/login`에 쿠키를 전달해 관리자 세션을 확인합니다. 세션을 저장하거나 응답의 사용자 정보를 로그에 기록하지 않습니다. 일반 사용자·MFA 미완료 사용자·검증 실패는 차단합니다. 이는 n8n 내부 API이므로 업그레이드 시 재검증해야 합니다. 기존 n8n CSP를 약화하지 않으며 CSP에 의해 UI 삽입이 차단되는 환경은 별도 검증 대상입니다.

전체 통계는 owner/admin에게만 제공하며 프로젝트별 사용자에게 공개하지 않습니다. Insights 보존 기간과 누적 통계 기간은 다를 수 있습니다. 상위 100개 워크플로만 API로 제공하며 누락을 0회로 표시하지 않습니다. 설치 전 월별 이력을 복원하지 않습니다.

SQLite 볼륨에 수집 이력을 보존하며 현재 자동 삭제 정책은 없습니다. 용량을 관리하고 백업 시 수집기를 정지하거나 SQLite backup API를 사용하세요. Compose `down -v`와 PVC 수동 삭제는 이력을 삭제합니다. DB 소스가 바뀌면 새 볼륨을 사용해야 합니다.

## 셸 설치기 사용 범위

호스트 설치기는 Bash와 표준 Unix 명령, Docker Compose만 사용합니다. JSON/YAML 파싱은 하지 않으며 Docker의 기본 조회 템플릿으로 실행 중인 n8n의 비밀 아닌 설정만 읽습니다. 별도 Python·Node.js·jq·yq 설치나 Docker 소켓을 전달하는 설치 컨테이너는 필요 없습니다.

간편 설치는 실행 중인 단일 n8n, 하나의 Docker 네트워크, 공개 포트 하나를 대상으로 합니다. 서비스명이 `n8n`이 아니면 `--service 이름`을 지정하세요. `--check`도 실행 중인 n8n이 필요합니다. 한 체크아웃에서 하나의 n8n 설치를 관리하며 설정 기록은 `.local/attach.env`, 추가 Compose는 `.local/compose.meter.yaml`에 보관합니다. 기록은 셸 코드로 실행하지 않습니다.

이전 Python 설치기로 실제 적용한 환경은 이전 버전에서 제거한 뒤 새 셸 설치기를 적용하세요. 설치 이력을 임의로 섞지 않습니다. `scripts/verify-gateway.py`는 개발자가 사용하는 선택적 검증 도구이며 사용자 설치에는 호출되지 않습니다.
