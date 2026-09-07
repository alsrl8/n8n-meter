# n8n Meter

기존 n8n 화면에 워크플로별 `사용량` 버튼과 집계 도움말을 추가하는 서버 설치형 도구입니다. Chrome 확장은 필요하지 않습니다. 기존 n8n과 별도로 설치하고 관리합니다.

**현재 상태: PostgreSQL 기반 PoC. n8n 2.26.9의 통계 소스를 확인했으며 모든 버전의 동작이나 최종 청구 건수와의 일치를 보장하지 않습니다.** 소스 저장소는 https://github.com/alsrl8/n8n-meter 입니다. 공개 컨테이너 이미지는 아직 배포하지 않았습니다. 먼저 아래 명령으로 소스를 준비합니다.

```sh
git clone https://github.com/alsrl8/n8n-meter.git
cd n8n-meter
```

## 무엇이 설치되나요?

```text
관리자 브라우저 → n8n Meter 화면 프록시 → 기존 n8n
                        ↓
                   n8n Meter 수집기 → 기존 n8n PostgreSQL (SELECT)
                        ↓
                   별도 SQLite 볼륨
```

추가 컨테이너는 수집기와 프록시 두 개입니다. Kubernetes에서는 한 Pod에 두 컨테이너로 설치합니다. n8n 이미지·워크플로·DB 스키마를 변경하지 않습니다. DB 접속 비밀은 서버의 파일 또는 Kubernetes Secret으로만 전달하며 브라우저나 외부 서비스에 전송하지 않습니다. Docker 소켓도 마운트하지 않습니다.

기본 설치는 **별도 관리자용 주소**를 제공합니다. 기존 n8n 주소와 webhook 경로는 그대로 유지합니다. n8n Meter 주소에는 별도의 관리자 인증(사용자명 `n8nmeter`)이 있고, 그 다음 기존 n8n 로그인을 사용합니다. 통계 API는 n8n 프로젝트별 권한을 적용하지 않으므로 이 주소를 일반 사용자에게 공개하지 마세요. 모든 워크플로 이름·ID·통계를 볼 수 있는 운영자용입니다.

## n8n 업그레이드와 호환성

**n8n Meter는 n8n UI의 DOM·Vue 컴포넌트 구조와 내부 통계 테이블에 의존합니다. n8n 업그레이드로 버튼 삽입, ID 연결, 통계 해석이 깨질 수 있습니다.** 공개 안정 API만 사용하는 제품이 아닙니다.

| 대상 | 현재 확인 범위 |
|---|---|
| n8n | 2.26.9 통계 구현과 카드/메뉴 컴포넌트 확인 |
| DB | PostgreSQL만 지원. SQLite/MySQL 미지원 |
| UI | 웹 루트(`/`)에서 제공되는 n8n, 워크플로 목록의 항상 표시 버튼 |
| 인증/경로 | 별도 관리자 주소. SSO 리디렉션·서브경로·강화된 CSP는 환경별 검증 필요 |
| 과금 | 라이선스 전송 원천 통계이며 최종 청구값·Usage and plan과의 일치를 보장하지 않음 |

업그레이드는 먼저 테스트 환경에서 진행하고 [COMPATIBILITY.md](COMPATIBILITY.md)의 체크리스트를 실행하세요. `source.n8nVersion`/`N8N_VERSION`은 관리자가 설정하는 값이며 실제 버전 자동 탐지가 아닙니다. 미검증 버전 표시를 없애기 위해 검증된 버전으로 거짓 설정하지 마세요. 원래 n8n 주소로 우회하면 n8n Meter UI 없이 계속 사용할 수 있습니다.

## 설치 전 준비 — 비밀번호 전달 대신 기존 환경 참조

필요한 것은 n8n 내부 URL, DB 주소/DB명, 연결 가능한 네트워크, **전용 읽기 계정의 비밀번호 파일 또는 Secret 참조**입니다. 설치자가 비밀번호를 개발자에게 전달할 필요는 없습니다.

단, **기존 n8n DB 계정은 보통 쓰기 권한이 있어 그대로 재사용할 수 없습니다.** 현재 수집기는 superuser 또는 통계 테이블 쓰기 권한 계정을 거부합니다. 읽기 계정이 없다면 DB 관리자가 먼저 준비해야 합니다. quick-start는 계정 생성·권한 변경·비밀번호 추출을 하지 않습니다.

```sql
-- DB 관리자가 환경의 DB명, 스키마, 테이블 prefix에 맞게 실행합니다.
-- 비밀번호 지정은 조직의 DB/Secret 관리 절차를 사용합니다.
CREATE ROLE n8nmeter_reader LOGIN;
GRANT CONNECT ON DATABASE n8n TO n8nmeter_reader;
GRANT USAGE ON SCHEMA public TO n8nmeter_reader;
GRANT SELECT ON public.workflow_statistics,
  public.insights_raw, public.insights_by_period TO n8nmeter_reader;
```

수집기는 단일 연결, READ ONLY 트랜잭션, 5초 쿼리 제한을 사용합니다. 실행 본문·노드 데이터·라이선스 인증서는 조회하지 않습니다. 외부 DB가 TLS를 요구하면 `PGSSLROOTCERT` CA 파일(Compose override) 또는 `database.caSecret`(Helm)을 연결하세요. 인증서 검증을 끄지 않습니다.

## Docker Compose quick-start

기존 n8n Compose와 별도 프로젝트로 실행합니다. Docker Compose v2와 기존 n8n 네트워크가 필요합니다.

```sh
./scripts/quick-start.sh compose init
# .local/compose.env의 아래 항목을 기존 설치에 맞게 편집
```

| 설정 | 예시 / 의미 |
|---|---|
| `N8N_NETWORK` | `n8n_default` — 기존 n8n/DB에 연결 가능한 Docker 네트워크 |
| `N8N_UPSTREAM` | `http://n8n:5678` — 그 네트워크에서 접근 가능한 n8n 서비스명 |
| `PGHOST`, `PGDATABASE`, `PGUSER` | `postgres`, `n8n`, `n8nmeter_reader` |
| `N8N_METER_DB_PASSWORD_FILE` | 서버에 이미 있는 읽기 계정 비밀번호 파일의 **절대 경로** |
| `N8N_METER_AUTH_PASSWORD_FILE` | 운영자용 비밀번호 파일의 절대 경로 |
| `N8N_METER_SOURCE_ID`, `N8N_VERSION` | 고정 소스 식별자, 실제 n8n 버전 |
| `N8N_METER_PORT` | 기본 `7812`, loopback에만 공개 |

비밀번호 파일에는 비밀번호 한 개만 넣습니다. Compose가 이를 파일로 마운트합니다. Linux에서는 수집기 UID 1000이 파일을 읽을 수 있도록 소유자/ACL을 설정하세요. 비밀번호를 `.env`, Git, 명령행 인수에 넣지 않습니다. 운영자 비밀번호 파일을 새로 만들 때는 다음처럼 대화형으로 입력할 수 있습니다(기존 파일은 덮어쓰지 않음).

```sh
python3 - <<'PY'
import getpass, os
from pathlib import Path
path = Path('.local/operator-password')
password = getpass.getpass('n8n Meter operator password: ')
if len(password) < 16:
    raise SystemExit('Use at least 16 characters')
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(password)
PY
./scripts/quick-start.sh compose check
./scripts/quick-start.sh compose up
./scripts/quick-start.sh compose status
```

`up`은 두 이미지를 소스에서 빌드하고 수집 성공을 기다립니다. **새 이미지를 처음 빌드할 때 베이스 이미지와 npm 패키지 다운로드가 필요합니다.** 시작 실패 시 `docker compose --env-file .local/compose.env -f compose.yaml logs --tail 50 n8nmeter`로 오류 코드를 확인하세요.

서버 로컬에서 `http://127.0.0.1:7812`를 열고 `n8nmeter` 계정으로 인증합니다. 원격 서버라면 `ssh -L 7812:127.0.0.1:7812 your-server` 터널을 사용할 수 있습니다. 인터넷에 HTTP 포트를 직접 공개하지 말고 TLS와 접근제어를 적용한 관리자 전용 주소를 사용하세요.

## Helm quick-start — 이미 Helm으로 n8n을 운영하는 경우

기존 n8n release를 수정하지 않고 별도 n8n Meter release를 설치합니다. Helm, kubectl, 기존 namespace, PVC용 StorageClass, DB/n8n 서비스에 접근 가능한 네트워크가 필요합니다.

공개 이미지는 아직 없으므로 **두 이미지를 사내 registry에 먼저 빌드·게시**하고 values의 repository/tag를 실제 주소로 바꿉니다. 폐쇄망은 조직의 이미지 반입 절차를 사용합니다.

```sh
docker build -t YOUR_REGISTRY/n8n-meter:0.1.0 .
docker build -f gateway/Dockerfile -t YOUR_REGISTRY/n8n-meter-gateway:0.1.0 .
docker push YOUR_REGISTRY/n8n-meter:0.1.0
docker push YOUR_REGISTRY/n8n-meter-gateway:0.1.0
./scripts/quick-start.sh helm init
# .local/values.yaml 편집: 이미지, upstream, DB, Secret 참조, 실제 n8n 버전
./scripts/quick-start.sh helm check
N8N_METER_CONTEXT=your-context N8N_METER_NAMESPACE=n8n ./scripts/quick-start.sh helm up
```

위 `YOUR_REGISTRY`/`your-context`는 사용 환경 값으로 바꿉니다. [values 예제](examples/values.existing-n8n.yaml)의 `database.existingSecret`과 `auth.existingSecret`은 **같은 namespace의 기존 Secret**을 참조합니다. 키 이름은 각각 `passwordKey`로 지정합니다. DB TLS는 `database.caSecret`/`caKey`, 저장소는 `persistence.storageClassName`으로 설정합니다. 기본 imagePullPolicy는 IfNotPresent이며 private registry 인증은 namespace의 ServiceAccount imagePullSecrets 등 조직의 기존 절차를 사용하세요.

```sh
kubectl --context your-context -n n8n port-forward svc/n8nmeter 7812:8080
# http://127.0.0.1:7812 에서 n8n Meter 인증 후 n8n 로그인
```

Ingress는 자동 생성하지 않습니다. 기존 ingress/controller별 인증·TLS 정책이 다르므로 검증 후 관리자용 호스트를 `n8nmeter:8080`에 연결하세요. 기존 webhook/외부 API 주소를 이 프록시로 바꾸지 마세요. 프록시는 n8n Meter Basic 인증을 n8n으로 전달하지 않으므로 외부 Bearer API 클라이언트용 경로가 아닙니다.

## Kubernetes quick-start — Helm release 없이 매니페스트로 관리

중복 템플릿의 불일치를 피하려고 **로컬 Helm CLI로 YAML만 생성**합니다. 클러스터에 Helm을 설치하거나 release를 만들지는 않습니다. Helm 방식과 동일하게 이미지·Secret을 준비합니다.

```sh
./scripts/quick-start.sh k8s init
# .local/values.yaml을 편집 (이미 helm init을 했다면 같은 파일 재사용)
./scripts/quick-start.sh k8s render
# .local/n8nmeter.yaml 검토 또는 GitOps 저장소로 전달 (비밀값은 포함하지 않음)
N8N_METER_CONTEXT=your-context N8N_METER_NAMESPACE=n8n ./scripts/quick-start.sh k8s up
```

`up`은 서버 dry-run 통과 후 apply하고 rollout을 기다립니다. 기존 namespace를 생성하거나 Secret을 수정하지 않습니다. Helm 설치와 kubectl 설치를 **동일 release 이름으로 혼용하지 마세요.** `N8N_METER_RELEASE`(기본 n8nmeter), `N8N_METER_VALUES`, `N8N_METER_ENV_FILE`로 독립 설치를 구분할 수 있습니다.

## 집계 기준과 제한

2.26.9의 `license-metrics.service`, `license-metrics.repository`, `workflow-statistics.service`, `insights-collection.service` 소스를 확인했습니다.

- `workflow_statistics`의 `production_success` + `production_error`: `count` 합계는 전체 프로덕션, `rootCount` 합계는 루트 실행 누적입니다. 실패한 루트는 `production_error.rootCount`입니다.
- 이 버전은 success/error/crashed 완료 상태와 cli/error/retry/trigger/webhook/evaluation mode를 root로 기록합니다. **Error Workflow도 포함**됩니다. 최종 청구 규칙 확정은 별도입니다.
- Insights는 보존된 raw + 기간 집계의 성공·실패 합계를 읽습니다. 보존 기간이 누적 통계와 다르므로 차이를 과금 오차로 계산하지 않습니다.
- API는 상위 100개 워크플로를 제공합니다. 없는 ID를 0회로 표시하지 않습니다. 설치 전 월별 이력은 복원하지 않습니다.
- SQLite에 관측값을 저장합니다. 카운터 감소·행 삭제 시 증가량은 미확정 처리합니다. 자동 보존/삭제 정책은 아직 없으며 볼륨 용량을 관리해야 합니다.
- 소스 DB를 변경할 때 기존 SQLite 볼륨을 재사용하지 마세요. 소스 식별자가 바뀌면 시작을 거부합니다.

## 상태 확인·중지·복구

```sh
./scripts/quick-start.sh compose status
./scripts/quick-start.sh compose stop
# 또는 같은 context/namespace/release 설정으로
./scripts/quick-start.sh helm status
./scripts/quick-start.sh helm stop
```

Compose stop은 n8n Meter 두 컨테이너만 중지합니다. Helm/k8s stop은 n8n Meter Deployment를 0개로 축소합니다. 다시 up하면 재개합니다. 기존 n8n 주소는 계속 사용할 수 있습니다. Compose `down -v`와 PVC 삭제는 이력을 지우므로 실행하지 마세요. Helm uninstall에서 PVC는 keep 처리하지만 수동 YAML 삭제는 PVC도 지울 수 있습니다.

수집기 `/healthz`는 프로세스, `/readyz`는 최근 수집 성공입니다. gateway `/__n8nmeter/healthz`는 프록시 상태만 확인합니다. DB 권한 거부는 `READ_ONLY_ROLE_REQUIRED`/`DB_PERMISSION_DENIED`, 스키마 불일치는 `UNSUPPORTED_SCHEMA`로 나타납니다. readiness 실패를 우회해 설치 성공으로 처리하지 않습니다.

백업은 수집기를 정지하고 SQLite 볼륨 전체를 복사하거나 SQLite backup API를 사용합니다. 프록시/수집기 업데이트 전 이미지 tag와 values를 보관하고, 문제가 생기면 원래 n8n 주소를 사용하면서 이전 tag로 재배포하세요. SQLite 스키마 호환성을 확인하지 않은 다운그레이드는 하지 않습니다.

## 개발·기여

Node 22.13 이상에서 `npm ci`, `npm test`. [COMPATIBILITY.md](COMPATIBILITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), [VERIFICATION.md](VERIFICATION.md)를 함께 봅니다. CI/공개 릴리스나 실제 Kubernetes 배포 성공은 로컬 렌더링 성공과 구분합니다.

[Chrome 확장 PoC](extension/README.md)는 선택적 개발 도구이며 설치 기본 경로가 아닙니다. 서버 설치에는 확장 로드가 필요 없습니다.

설치 구성 근거: [Compose Secret 파일](https://docs.docker.com/reference/compose-file/secrets/), [NGINX 인증 서브요청](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html), [Helm upgrade/install](https://docs.helm.sh/docs/helm/helm_upgrade/).

## License

[MIT](LICENSE). n8n Meter는 n8n의 공식 제품이 아니며 n8n 소스나 이미지를 재배포하지 않습니다. n8n 및 각 의존성의 라이선스는 해당 프로젝트의 조건을 따릅니다.
