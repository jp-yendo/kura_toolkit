# Kura Toolkit

## 1. システム概要

Kura Toolkit は、音声・動画・画像・ファイル整理の 4 つのユーティリティを 1 つにまとめたデスクトップアプリケーションです。ダッシュボードとタイトルバーのカテゴリメニューから各機能へアクセスできます。

### オーディオ: オーディオ正規化

- 音声ファイル (wav / mp3 / aac / flac) のラウドネス (LUFS) とチャンネル数を解析
- 指定したターゲット LUFS へ正規化して出力 (元のフォーマット・タグ・アルバムアートを維持)
- サンプリング周波数、ビットレートモード (CBR/VBR)、ビットレートを指定可能

### 動画: チャプターカット

- 動画のチャプター一覧を表示
- チャプター範囲を指定して再エンコードなし (ストリームコピー) で切り出し。開始点は直前のキーフレームに自動吸着し、チャプター情報も出力へ引き継ぎます
- 指定チャプターの直前を分割点として複数ファイルへ分割
- フレーム精度モード: 元のコーデック・ビットレートを可能な範囲で引き継いだ再エンコードにより、チャプター開始位置で正確に切り出し
- mkv のテキスト字幕は時刻を再構成して正しく引き継ぎます

### 画像: SVG 変換

- 画像 (PNG / JPEG / BMP / GIF / TIFF) をベクター形式の SVG に変換 (VTracer エンジン)
- クラスタリング / カーブフィッティングの各パラメータを調整可能
- 元画像と変換結果を並べてプレビューし、SVG ファイルとして保存

### ツール: クリーンアップ

- Windows Zone.Identifier、Thumbs.db、.DS_Store、macOS のメタデータファイル/ディレクトリなど 11 種類の不要ファイルを検索
- Zone.Identifier は、Windows では代替データストリームとして、Windows からコピーしたり書庫を解凍した macOS/Linux 上では `ファイル名:Zone.Identifier` という通常のファイルとして検出します
- 検索対象はホームディレクトリ、各ドライブ/ボリューム、任意の追加ディレクトリから選択 (システムディレクトリは自動的に除外)。CD/DVD など書き込みできないメディアは一覧に表示されません
- 検出した項目を選択してゴミ箱へ移動 (Zone.Identifier のみ直接削除)

macOS では、デスクトップ・書類・ダウンロードなどのフォルダを検索するために「フルディスクアクセス」の許可が必要です。未許可の場合はクリーンアップ画面に案内が表示され、そこからシステム設定を開けます (許可後はアプリの再起動が必要です)。

### アプリ設定

- テーマ (ライト / ダーク / システム)、言語 (日本語 / 英語)
- ディレクトリの探索に使うスレッド数 (1〜100)。初回起動時に論理コア数の半分 (最大 4) が設定されます。
  大きくするとクリーンアップの検索が速くなりますが、HDD やネットワークドライブでは逆に遅くなることがあります
- ffmpeg / ffprobe の実行ファイルパス (未設定時は PATH から自動検出)
- 設定は `~/.kura_toolkit/settings.json` に保存されます

### 必要な外部ツール

オーディオ正規化とチャプターカットには [FFmpeg](https://ffmpeg.org/) (ffmpeg / ffprobe) が必要です。アプリには同梱していないため、別途インストールしてください。PATH に加えて一般的なインストール先 (macOS の Homebrew など) も自動的に検出します。見つからない場合はアプリ設定でパスを指定してください。SVG 変換とクリーンアップは外部ツール不要です。

## 2. 対応OS

- Windows 10/11
- macOS 10.15+
- Linux (Debian系/RHEL系)

注記: 本プロジェクトは Windows ではコード署名を行っていません。SmartScreen が警告を表示する場合は「詳細情報」→「実行」を選択してください。

## 3. 開発者向けリファレンス

### 必要要件

- Node.js 22.x以上
- yarn 4
- Git

### インストール

```bash
# リポジトリのクローン
git clone https://github.com/jp-yendo/kura_toolkit.git
cd kura_toolkit

# 依存関係のインストール
yarn install

# 開発起動
yarn dev
```

開発時のDevTools:

- DevTools はデタッチ表示で自動的に開きます
- F12 または Ctrl+Shift+I（macOSは Cmd+Option+I）でトグル可能

### ビルド/配布

- Windows: `yarn dist:win`
- macOS: `yarn dist:mac`
- Linux: `yarn dist:linux`

開発時は `http://localhost:3001` を、配布ビルドでは `dist/renderer/index.html` を読み込みます。ページ遷移はどちらも HashRouter で行います。

### GitHub への直接リリース (自動アップデート用)

`electron-builder.yml` の `publish:` に設定した GitHub リポジトリに、ビルド成果物と `latest*.yml` (自動アップデート用メタデータ) を直接アップロードするコマンドです。`releaseType: draft` 設定のため、各コマンドは GitHub 上の **同一バージョンのドラフトリリースに集約** されます。全プラットフォーム揃ってから GitHub UI で「Publish release」を押すとユーザーへ配信されます。

- Windows: `yarn release:win`
- macOS: `yarn release:mac`
- Linux: `yarn release:linux`

実行前に GitHub Personal Access Token (`public_repo` スコープ) を環境変数 `GH_TOKEN` に設定してください。

```bash
export GH_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
```

複数台で各プラットフォームをビルドする場合は、`package.json` の `version` を全マシンで一致させた上で、各マシンで該当する `release:*` を順に実行してください。

### macOS 事前準備: 署名・公証用の環境変数

macOS 向けに署名・公証付きビルドを行う場合は、`yarn dist:mac` の実行前に以下の環境変数を設定してください。

```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

### Windows 事前準備: 開発者モード

Windows で署名なしのローカルビルド/配布物を実行・テストする場合は、OSの開発者モードを有効にしてください。

1. 設定 → プライバシーとセキュリティ → 開発者向け
2. 「開発者モード」をオンにする
3. OSを再起動

### プロジェクト構造 (抜粋)

```text
src/
├── main/                  # Electron メイン: IPC/各種サービス
│   ├── index.ts           # 起動・ウィンドウ生成・サービス初期化
│   ├── ipc/               # IPCハンドラ
│   ├── services/          # 設定・ジョブ管理・ffmpeg・各機能サービス
│   ├── workers/           # worker_threads のエントリ (ディレクトリ走査ワーカー)
│   └── utils/             # 各種ユーティリティ
├── preload/               # renderer へ安全にAPIをブリッジ (window.kuraToolkit)
├── renderer/              # React + MUI UI (pages/stores/components/i18n)
├── shared/                # 型定義・定数(Default設定/保存パス)
└── public/                # アイコン等
```

詳細な仕様は [Documents/システム仕様.md](Documents/システム仕様.md) を参照してください。

### 使用技術

- **Electron**
- **React (MUI)**
- **TypeScript**
- **Zustand**
- **i18next**
- **Vite**
- **@neplex/vectorizer** (VTracer)

### Windows用アイコンの作成

```exec
magick public/icon.png -define icon:auto-resize=256,128,96,64,48,32,24,16 public/icon.ico
```

## 4. ライセンス

本プロジェクトは [MIT License](LICENSE) で公開されています。

FFmpeg はアプリに同梱せず、ユーザー環境にインストールされたものを外部プロセスとして呼び出します。そのため FFmpeg 自体のライセンス (GPL/LGPL ビルド) は本アプリの配布物には影響しません。
