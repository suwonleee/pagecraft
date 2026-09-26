# Pagecraft

[English](../README.md) · **한국어** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

**AI가 만든 HTML, 이제 내 방식으로 다듬으세요.**

보고서, 랜딩 페이지, 정적 시안을 열고 제목과 배치를 수정한 뒤 일반 HTML로 저장합니다. 페이지를 다시 만들거나 AI에게 전체 재생성을 요청할 필요가 없습니다. 계정, API 키, AI 구독 없이 편집할 수 있습니다.

[**브라우저에서 바로 사용하기 →**](https://suwonleee.github.io/pagecraft/)

![실제 영어 화면: 보고서의 제목, 스타일, 레이아웃 편집](../docs/images/edit-report.png)

## 이렇게 활용하세요

### AI 초안을 공유할 수 있는 보고서로

**보고서**에서 주간 보고서나 의사결정 보고서 템플릿을 선택하거나 AI가 만든 완전한 HTML을 붙여넣으세요. 문장을 더블클릭해 고치고, 속성 패널에서 글자 크기·색상·여백을 조절한 뒤 HTML을 다운로드합니다. 템플릿에는 의미 있는 요소 ID, 반응형 배치, A4 인쇄 스타일이 들어 있습니다.

![영어 보고서 템플릿과 HTML 붙여넣기, AI 작성 요청 화면](../docs/images/report-templates.png)

1. 보고서 메뉴에서 주간 보고서를 엽니다.
2. 제목을 더블클릭하거나 속성 패널의 텍스트 입력란에서 수정합니다.
3. 글자 크기, 색상, 간격을 조절합니다.
4. HTML을 다운로드한 뒤 다시 열어 결과를 확인합니다.

템플릿은 가상 예시입니다. 공유하기 전에 예시 문장과 대괄호 안의 내용을 실제 자료로 교체하세요. Pagecraft는 수치를 만들거나 AI 서비스를 호출하지 않습니다.

### 랜딩 페이지를 빠르게 다듬기

샘플에서 제목과 버튼 문구를 바꾸고 데스크톱·태블릿·모바일 너비로 확인하세요. 요소 이동, 크기 조절, 복제, 삭제, 정렬과 실행 취소를 지원합니다.

![실제 영어 샘플 랜딩 페이지 편집](../docs/images/edit-landing.png)

저장 결과는 일반 HTML입니다. 브라우저에서 열거나 Git으로 관리하고, 원하는 정적 호스팅에 게시할 수 있습니다. 위 이미지는 영어 UI에서 촬영한 실제 화면이며, 앱 메뉴에서 한국어를 선택할 수 있습니다.

## 로컬에서 시작하기

로컬 빌드에는 **Node.js 22.12 이상**과 npm이 필요합니다. `.nvmrc`는 Node.js 24를 지정합니다.

```sh
git clone https://github.com/suwonleee/pagecraft.git
cd pagecraft
npm ci
npm run build:web
npm run serve:web
```

**http://127.0.0.1:4318/** 을 열고 보고서나 샘플로 시작하거나 자신의 HTML을 가져오세요.

### 언어 설정

기본 언어는 영어입니다. 상단 언어 메뉴에서 **English / 한국어 / 简体中文 / 日本語**를 선택하면 메뉴, 안내·오류 메시지, 새 보고서 템플릿, 샘플, AI 작성 요청문이 해당 언어로 바뀝니다. 기존에 가져온 문서의 내용은 번역하지 않습니다.

설정은 브라우저의 `localStorage`에 `pagecraft-language` 키로 저장합니다. 값은 `en`, `ko`, `zh-CN`, `ja`입니다. 브라우저 프로필과 접속 주소마다 별도로 유지되며 서버 설정이나 계정은 필요 없습니다. 값이 없거나 지원하지 않는 값이면 영어를 사용합니다. 사이트 데이터를 지우면 설정도 초기화됩니다.

언어를 바꾸면 편집기가 새로고침됩니다. 먼저 파일을 저장하세요. 미저장 내용이 있으면 확인창에서 전환을 취소하고 편집을 계속할 수 있습니다. 오프라인 준비가 완료된 웹 앱과 확장 프로그램에는 네 언어가 모두 포함됩니다.

### 작업에 맞는 실행 방식

| 방식 | 용도 | 저장 |
|---|---|---|
| 브라우저 앱 | 하나의 독립 HTML | 지원 브라우저에서 권한을 부여한 원본에 저장하거나 편집본 다운로드 |
| 로컬 폴더 서버 | CSS·이미지·폰트가 옆에 있는 프로젝트 | 지정 폴더 안에 저장, 백업·충돌 확인 |
| 설치형 웹 앱 | 앱 아이콘으로 실행 | 브라우저와 같은 파일 권한 사용, 지원 환경에서 ‘연결 프로그램’으로 HTML 열기 |
| 선택형 확장 프로그램 | Chrome 도구 모음에서 편집기 실행 | 현재 웹사이트를 캡처하거나 수정하지 않고 별도 편집기 사용 |
| 문서 CLI | 코딩 에이전트와 자동화 | 해시 검증 후 원본 수정 또는 새 파일 생성 |

```sh
npm start -- ./drafts
npm start -- ./report.html --port 4319
```

폴더 모드의 기본 주소는 **http://127.0.0.1:4317** 입니다. 서버를 켜 두세요. 경로 없이 `npm start`를 실행하면 `.pagecraft/`에 시작 문서가 생성됩니다. 이 기본 작업공간 문서와 CLI 출력은 영어입니다.

### 저장은 직접 실행합니다

- HTTPS 또는 localhost의 Chromium 계열 브라우저에서 원본 파일을 열고 권한을 허용하면 원본에 저장할 수 있습니다.
- 가져온 사본, 붙여넣은 HTML, 템플릿은 편집 후 다운로드합니다. 다운로드는 원본을 덮어쓰거나 원본의 미저장 상태를 해제하지 않습니다.
- 브라우저 임시 초안은 별도 사본으로 복구할 수 있습니다. 파일 저장을 대신하지 않습니다.

브라우저 모드는 최대 **16 MiB**의 UTF-8 HTML 파일 한 개를 처리합니다. 옆 폴더의 자산을 자동으로 읽지 못하므로 HTML에 포함하거나 폴더 모드를 사용하세요. [저장·복구 상세 안내 (영어)](../docs/USAGE.md)

## 코딩 에이전트와 같은 파일 편집하기

화면에서 시각적으로 다듬고, Claude Code·Codex 등 코딩 에이전트에는 정확한 부분 수정을 맡길 수 있습니다. CLI는 실행 중인 편집기 서버나 AI 제공업체 SDK 없이 저장된 파일을 처리합니다.

```sh
npm run --silent document -- inspect ./report.html --query weekly-summary-lead
```

에이전트에 이렇게 요청하세요.

> `docs/AI_EDITING.md`를 읽고 `report.html`의 요약을 줄여줘. 나머지 문장, 스타일, ID, 인쇄 규칙은 보존해줘. 쓰기 전에 패치를 검증하고 문서 전체를 재생성하지 마.

검사에서 얻은 해시를 사용해 `edits.json`을 만듭니다.

```json
{
  "version": 1,
  "hash": "REPLACE_WITH_THE_HASH_FROM_INSPECT",
  "changes": [
    { "target": "weekly-summary-lead", "text": "핵심 흐름은 검토할 준비가 됐습니다. 효과는 측정 중입니다." }
  ]
}
```

```sh
npm run --silent document -- apply ./report.html --patch edits.json --dry-run
npm run --silent document -- apply ./report.html --patch edits.json --write
```

**넘기기 전에는 시각 편집 내용을 저장하고, 에이전트가 수정한 뒤에는 문서를 다시 여세요.** 오래된 해시는 거부하며 `--write`는 이전 파일을 백업합니다. 실시간 병합이 아닌 순차 인계 방식입니다. [에이전트 작업 절차 (영어)](../docs/AI_EDITING.md)

## 확장 프로그램과 배포

```sh
npm run build:extension
```

Chrome의 `chrome://extensions`에서 개발자 모드를 켜고 ‘압축해제된 확장 프로그램을 로드합니다’로 `extension-dist/`를 선택하세요. 도구 모음의 Pagecraft 아이콘으로 실행합니다. 호스트 권한이나 페이지 삽입 스크립트는 요청하지 않습니다. 확장 스토어에는 등록되어 있지 않습니다.

`npm run build:web`의 `web-dist/`를 정적 서버에 배포할 수 있습니다. HTTP(S)로 제공하고 하위 경로 주소는 `/`로 끝내세요. **`file://`로 index.html을 직접 여는 방식은 지원하지 않습니다.** 미리 빌드한 ZIP 제공 여부는 [Releases](https://github.com/suwonleee/pagecraft/releases)에서 확인하세요.

## 주요 조작과 제한

| 작업 | 조작 |
|---|---|
| 텍스트 편집 | 더블클릭 또는 속성 패널 |
| 다중 선택 | Shift+클릭 또는 빈 캔버스에서 드래그 |
| 이동 | 드래그, Alt/Option으로 스냅 해제 |
| 복제 / 삭제 | `⌘/Ctrl+D` / `Delete` |
| 실행 취소 / 다시 실행 | `⌘/Ctrl+Z` / `⌘/Ctrl+Shift+Z` |
| 화면 이동 / 확대·축소 | Space+드래그 / `⌘/Ctrl+스크롤` |
| 저장 / 다운로드 | `⌘/Ctrl+S` 또는 `⌘/Ctrl+Enter` |

저장은 HTML 전체를 재작성하지 않고 수정된 소스 범위를 패치합니다. 브라우저에서는 기기에서 처리하고 폴더 서버는 루프백 주소에서 실행합니다.

정적 `.html`과 `.htm`이 대상입니다. 미리보기에서 스크립트와 외부 자원은 차단되어 원본과 다르게 보일 수 있습니다. SVG·canvas는 보존하지만 내부 도형을 개별 HTML 요소로 편집할 수 없습니다. PPTX, Figma, draw.io, 요소의 부모 변경·순서 변경, 실시간 공동 편집은 지원하지 않습니다. [구조와 제한 (영어)](../docs/ARCHITECTURE.md)

## 개발

```sh
npm run check
npm run test:e2e
npm run test:browser
npm run test:extension
npm run build
```

브라우저 테스트 설치: `npx playwright install chromium firefox webkit`. 로컬 Chromium 테스트는 설치된 Chrome을 기본으로 사용합니다. 웹·확장 빌드는 출력 폴더를 공유하므로 순서대로 실행하세요.

[스크린샷 재현 (영어)](../docs/SCREENSHOTS.md) · [기여와 커밋 규칙 (영어)](../CONTRIBUTING.md) · [MIT 라이선스](../LICENSE)
