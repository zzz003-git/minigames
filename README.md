# 미니게임

미니게임 3개를 모아놓은 정적 웹사이트입니다. 빌드 과정이 없고, HTML/CSS/JS 파일만으로 동작합니다.

## 폴더 구조

```
minigames/
├── index.html          허브 (게임 목록)
├── style.css           공통 스타일
├── games/
│   ├── game1/          게임 1
│   ├── game2/          게임 2
│   └── game3/          게임 3
└── assets/             이미지·사운드 등
```

## 로컬에서 확인하기

`index.html`을 브라우저로 열면 바로 확인됩니다.

## 배포

`main` 브랜치에 push하면 Cloudflare Pages가 자동으로 배포합니다.
