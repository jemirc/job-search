# Job Search Engine

한국/해외 채용 공고를 통합 검색하고, AI로 이력서 적합도 분석 및 맞춤 이력서를 생성하는 웹 애플리케이션입니다.

## Features

### 채용 검색
- **사람인**, **원티드**, **eFinancialCareers**, **Adzuna** 통합 검색
- 한국어 입력 시 자동 영어 번역 → 해외 사이트 동시 검색
- 영어 입력 시 자동 한국어 번역 → 한국 사이트 동시 검색
- 소스별 필터 탭 (전체/사람인/원티드/eFinancial/Adzuna)
- 검색 결과 캐싱 (페이지 이동 후 복귀 시 유지)

### AI 적합도 분석 (Gemini / OpenAI)
- **적합도 분석 (Gemini)** 버튼으로 전체 공고 일괄 매칭 점수 계산
- **상세** 버튼 클릭 시:
  - 직무 요구사항 분석
  - 이력서 적합도 점수 (0~100점)
  - 상세 분석 및 보완이 필요한 영역
  - 공고 페이지 자동 파싱

### 맞춤 이력서 생성
- 영문/한글 이력서 각각 생성 가능
- Markdown 렌더링으로 깔끔한 표시
- PDF 다운로드 (한글 인코딩 지원)
- 복사 버튼

### 이력서 도구
- PDF/TXT/MD 이력서 업로드
- **매칭 점수** — 이력서 vs 채용 공고 적합도 분석 (일치 기술, 부족 기술, 제안사항)
- **이력서 수정** — 특정 공고에 맞게 이력서 재작성
- **추천 공고** — 이력서 기반 자동 키워드 추출 → 검색 → 매칭 점수 순위

### AI 어시스턴트
- 자기소개서 생성
- 면접 준비 자료 생성
- 채용 공고 분석
- 스킬 갭 분석

### 기타
- 한국어/English UI 전환
- 다크/라이트 모드
- 반응형 디자인 (모바일 사이드바)

## Tech Stack

| 구분 | 기술 |
|------|------|
| Framework | Next.js 16 + React 19 + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Database | SQLite (better-sqlite3) |
| AI | Google Gemini (`gemini-3-flash-preview`) 또는 OpenAI (`gpt-5.4-mini`) |
| PDF 파싱 | pdf-parse |
| PDF 생성 | 브라우저 Print API (한글 지원) |
| Markdown | react-markdown + @tailwindcss/typography |

## Getting Started

### 1. Clone & Install

```bash
git clone https://github.com/htk1019/job-search.git
cd job-search
npm install
```

### 2. API Key 설정

**방법 A: 설정 페이지에서 직접 입력 (권장)**

앱 실행 후 **설정** 페이지에서 API 키를 입력하면 로컬 DB에 저장됩니다.

**방법 B: 환경 변수 파일**

`.env.local` 파일을 생성합니다:

```env
# AI Provider - 둘 중 하나만 설정 (Gemini 우선)
GEMINI_API_KEY=your-gemini-api-key
# OPENAI_API_KEY=sk-your-openai-key

# 채용 검색 (선택사항)
ADZUNA_APP_ID=your-app-id
ADZUNA_API_KEY=your-api-key
```

| 서비스 | 발급 링크 | 비고 |
|--------|-----------|------|
| Gemini API | [Google AI Studio](https://aistudio.google.com/apikey) | 무료 |
| OpenAI API | [OpenAI Platform](https://platform.openai.com/api-keys) | 유료 |
| Adzuna API | [developer.adzuna.com](https://developer.adzuna.com/) | 무료 (250건/일) |

### 3. 실행

```bash
npm run dev
```

http://localhost:3001 에서 확인

### 4. 사용 순서

1. **설정** — API 키 입력
2. **이력서** — PDF/TXT/MD 업로드
3. **채용 검색** — 키워드 입력 → 통합 검색 → 적합도 분석 → 맞춤 이력서 생성

## Project Structure

```
src/
├── app/
│   ├── search/          # 채용 검색 (메인)
│   ├── resume/          # 이력서 도구
│   ├── assistant/       # AI 어시스턴트
│   ├── settings/        # API 키 설정
│   └── api/
│       ├── search/      # 통합 검색 + 분석 API
│       ├── resume/      # 업로드, 매칭, 수정, 추천
│       ├── ai/          # 자기소개서, 면접, 분석
│       └── settings/    # API 키 CRUD
├── lib/
│   ├── ai.ts            # 통합 AI 클라이언트 (Gemini/OpenAI)
│   ├── db.ts            # SQLite 연결
│   ├── i18n.ts          # 한국어/영어 번역
│   └── pdf-download.ts  # PDF 생성 (한글 지원)
└── components/
    ├── layout/          # 사이드바, 헤더, 테마, 언어
    └── ui/              # shadcn/ui 컴포넌트
```

## Data Storage

모든 데이터는 로컬에 저장되며 외부로 전송되지 않습니다.

| 항목 | 위치 |
|------|------|
| 데이터베이스 | `data/job-search.db` (자동 생성) |
| 업로드 파일 | `public/uploads/` |
| API 키 | DB `settings` 테이블 |
| 검색 캐시 | 브라우저 sessionStorage |

## License

MIT
