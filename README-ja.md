# Kura Toolkit

## 1. システム概要

Kura Toolkit は、音声・声・動画・画像・ファイル整理のユーティリティを 1 つにまとめたデスクトップアプリケーションです。ダッシュボードとタイトルバーのカテゴリメニューから各機能へアクセスできます。

### オーディオ: オーディオ正規化

- 音声ファイル (wav / mp3 / aac / flac) のラウドネス (LUFS) とチャンネル数を解析
- 指定したターゲット LUFS へ正規化して出力 (元のフォーマット・タグ・アルバムアートを維持)
- サンプリング周波数、ビットレートモード (CBR/VBR)、ビットレートを指定可能

### オーディオ: 音声分離

- 楽曲や音声を、ボーカルと伴奏、楽器別 (ドラム・ベース・ギター・ピアノなど)、メインボーカルとコーラスに分離。残響・エコー・ノイズの除去も可能 (audio-separator と Ultimate Vocal Remover のモデルを使用)
- audio-separator が提供する一覧のモデル、検証済みのアンサンブル、任意のモデルの組み合わせ、比較用の従来手法 (中央定位の打ち消し) から選択
- 結果は候補として並び、同期再生 (切り替えても再生位置が変わらない) で聞き比べて採用
- 採用した結果をさらに段階的に分離 (例: ボーカル → メインとコーラス → 残響除去)
- MP3 / FLAC での書き出し、音声変換への受け渡し

### オーディオ: 音声変換

- 歌声や話し声を、選んだ声のモデルの声質に変換 (RVC。Applio を使用)
- 楽曲は同じ画面で伴奏を分離してボーカルだけを変換し、音量バランス・リバーブ・リミッターを調整して伴奏と合成。キーを変えたときは伴奏も同じだけ移調
- 設定 (キー・ピッチ抽出・インデックスの効き具合・音量エンベロープ・子音の保護) を変えた変換結果を候補として聞き比べ
- 画面は「変換」「声のモデル」「モデルの学習」の 3 つを切り替えて使います。変換する音声を読み込まなくても、声のモデルの管理と学習はいつでも行えます
- 声のモデルの管理: RVC モデル (.pth / .index) の安全な取り込み、`.kuravoice` ファイルでの書き出しと取り込み、Hugging Face でのモデル検索
- アプリ内での録音や音声ファイルから、自分の声のモデルを学習 (Windows・macOS)

### オーディオ: 読み上げ

- 文章や字幕 (SRT / WebVTT) を日本語・英語で読み上げ (Style-Bert-VITS2 を使用。JP-Extra 版と多言語版のエンジン)
- 制御タグ (SSML のサブセット。入力中に構文チェック) で間・話速・音高・音量・読みを指定。日本語はアクセント記法、英語は IPA で発音を指定可能
- 字幕の各区間は開始時刻に配置。収まらない区間は、話速を上げる・次の区間と重ねる・後続をずらす・警告のみから選択
- 音声変換と同じく、「読み上げ」「声のモデル」「モデルの学習」を切り替えて使います
- プリセットの声 (JVNV コーパスのモデル) のダウンロード、Style-Bert-VITS2 のモデルの取り込み
- 提示される文を読み上げて録音し、自分の声のモデルを学習 (NVIDIA GPU を搭載した Windows のみ)
- 読み上げた音声を音声変換へ受け渡し

### 音声機能のダウンロード

音声分離・音声変換・読み上げには Python・パッケージ一式・モデルが必要です (アプリには同梱していません)。

- 各音声機能の画面右上の「ダウンロード管理」から開きます。足りないものがある場合は画面に一覧が表示され、それを選んだ状態でダウンロードを開けます
- 容量が大きいため、利用者が項目を選んで開始するまでは何もダウンロードせず、事前に容量を表示します
- 項目ごとと全体の進捗の表示、中断、再試行ができ、各項目は個別に削除できます
- アプリの更新で取得し直しが必要になった場合は、起動時に 1 回だけ確認します

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
- 保存場所 (ライブラリ・モデル・作業ディレクトリ)。それぞれ独立して変更でき、ライブラリとモデルのディレクトリは中身を選んだフォルダへ移動します
- 設定は `~/.kura_toolkit/settings.json` に保存されます

### 必要な外部ツール

オーディオ正規化・チャプターカットと音声機能 (音声分離・音声変換・読み上げ) には [FFmpeg](https://ffmpeg.org/) (ffmpeg / ffprobe) が必要です。アプリには同梱していないため、別途インストールしてください。PATH に加えて一般的なインストール先 (macOS の Homebrew など) も自動的に検出します。見つからない場合はアプリ設定でパスを指定してください。SVG 変換とクリーンアップは外部ツール不要です。

音声機能には、さらに次のものが必要です。

- 伴奏の移調 (音声変換) と字幕の区間への収め込み (読み上げ) には、rubberband フィルタを含む FFmpeg が必要です (Windows は winget の Gyan.FFmpeg、macOS は Homebrew の `ffmpeg` など)。設定中の FFmpeg に無い場合はアプリが案内します
- Python・パッケージ・モデルのダウンロードのためのインターネット接続 (合計で数 GB。CUDA 版の PyTorch だけで約 2〜2.7GB)
- Windows: [Microsoft Visual C++ 再頒布可能パッケージ](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist) (x64)
- macOS: 音声分離のパッケージ一式の導入に Xcode Command Line Tools (`xcode-select --install`)

## 2. 対応OS

- Windows 10/11
- macOS 10.15+
- Linux (Debian系/RHEL系)

音声分離・音声変換・読み上げは、Windows 10/11 (x64) と Apple Silicon の macOS 14 以降で利用できます。Windows では NVIDIA GPU (CUDA)、macOS では Apple Silicon の GPU (MPS) を使い、使えない場合は CPU で処理します。読み上げのモデルの学習には NVIDIA GPU を搭載した Windows が必要です (作成したモデルは書き出して Mac に取り込めます)。

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
├── python/                # 音声機能の Python スクリプト (ダウンロードした仮想環境で実行)
├── preload/               # renderer へ安全にAPIをブリッジ (window.kuraToolkit)
├── renderer/              # React + MUI UI (pages/stores/components/i18n)
├── shared/                # 型定義・定数(Default設定/保存パス)
└── public/                # アイコン等
third_party/               # 外部から取り込んだデータ。取り込み元ごとのフォルダ (読み上げのモデルの学習で提示する文章)
```

詳細な仕様は [Documents/システム仕様.md](Documents/システム仕様.md)、保存するデータの定義は [Documents/テーブル定義.md](Documents/テーブル定義.md) を参照してください。

### 使用技術

- **Electron**
- **React (MUI)**
- **TypeScript**
- **Zustand**
- **i18next**
- **Vite**
- **@neplex/vectorizer** (VTracer)
- **Python 3.11** (python-build-standalone。音声機能のために利用者の指示でダウンロード)
- **PyTorch**、**audio-separator**、**Applio**、**Style-Bert-VITS2** (sync-dev-org 版)、**pedalboard**

### Windows用アイコンの作成

```exec
magick public/icon.png -define icon:auto-resize=256,128,96,64,48,32,24,16 public/icon.ico
```

## 4. ライセンス

Copyright (C) 2026 jp-yendo

本プロジェクトは [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0) で公開されています。

FFmpeg はアプリに同梱せず、ユーザー環境にインストールされたものを外部プロセスとして呼び出します。そのため FFmpeg 自体のライセンス (GPL/LGPL ビルド) は本アプリの配布物には影響しません。

### 外部コンポーネント

音声機能は次のコンポーネントを利用します。学習用の文章を除き、アプリには同梱していません。利用者がダウンロードを開始したときだけ各配布元から取得し、版はアプリが固定しています。各項目のライセンスと取得元は「ダウンロード管理」にも表示されます。

| コンポーネント                                                       | 用途                              | ライセンス                                                                                                   | 取得元                                                            |
| -------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| python-build-standalone (CPython 3.11)                               | Python 実行環境                   | PSF-2.0 と同梱ライブラリの各ライセンス                                                                       | https://github.com/astral-sh/python-build-standalone              |
| PyTorch                                                              | 推論・学習                        | BSD-3-Clause                                                                                                 | https://pytorch.org                                               |
| audio-separator                                                      | 音声分離                          | MIT                                                                                                          | https://github.com/nomadkaraoke/python-audio-separator            |
| Ultimate Vocal Remover (UVR) のモデル                                | 音声分離                          | 各モデルの作者による。UVR (Anjok07 と貢献者) へのクレジット表記                                              | https://github.com/Anjok07/ultimatevocalremovergui                |
| Applio                                                               | 音声変換とその学習                | MIT                                                                                                          | https://github.com/IAHispano/Applio                               |
| RMVPE / FCPE / ContentVec ほかの埋め込みモデル、RVC の事前学習モデル | 音声変換とその学習                | MIT (Applio の配布物として)                                                                                  | https://huggingface.co/IAHispano/Applio                           |
| pedalboard                                                           | 合成 (リバーブ・リミッター)       | GPL-3.0                                                                                                      | https://github.com/spotify/pedalboard                             |
| faiss                                                                | 音声変換 (インデックス)           | MIT                                                                                                          | https://github.com/facebookresearch/faiss                         |
| Style-Bert-VITS2 (sync-dev-org 版、style-bert-vits2-mk)              | 読み上げとその学習                | AGPL-3.0 (ユーザー辞書関連は LGPL-3.0)                                                                       | https://github.com/sync-dev-org/Style-Bert-VITS2                  |
| deberta-v2-large-japanese-char-wwm                                   | 読み上げ (日本語 BERT)            | CC BY-SA 4.0                                                                                                 | https://huggingface.co/ku-nlp/deberta-v2-large-japanese-char-wwm  |
| deberta-v3-large                                                     | 読み上げ (英語 BERT)              | MIT                                                                                                          | https://huggingface.co/microsoft/deberta-v3-large                 |
| NLTK のデータ: CMUdict、averaged_perceptron_tagger                   | 読み上げ (英語の発音推定)         | CMUdict: 用途を問わず利用可 (Carnegie Mellon University) / tagger: MIT                                       | https://github.com/nltk/nltk_data                                 |
| Style-Bert-VITS2 JP-Extra の事前学習モデル                           | 読み上げの学習                    | AGPL-3.0                                                                                                     | https://huggingface.co/litagin/Style-Bert-VITS2-2.0-base-JP-Extra |
| Style-Bert-VITS2 の事前学習モデル (Bert-VITS2 2.1 の事前学習モデル)  | 読み上げの学習                    | モデルカードに記載なし。Bert-VITS2 (AGPL-3.0) 由来                                                           | https://huggingface.co/litagin/Style-Bert-VITS2-1.0-base          |
| WavLM Base+                                                          | 読み上げの学習 (JP-Extra)         | CC BY-SA 3.0                                                                                                 | https://huggingface.co/microsoft/wavlm-base-plus                  |
| wespeaker-voxceleb-resnet34-LM                                       | 読み上げの学習 (スタイルベクトル) | CC BY 4.0                                                                                                    | https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM    |
| pyannote.audio                                                       | 読み上げの学習                    | MIT                                                                                                          | https://github.com/pyannote/pyannote-audio                        |
| JVNV のプリセットの声                                                | 読み上げのプリセット              | CC BY-SA 4.0 (JVNV コーパスから継承)                                                                         | https://huggingface.co/litagin/style_bert_vits2_jvnv              |
| ITA コーパス (同梱)                                                  | 読み上げの学習用の文章 (日本語)   | パブリックドメイン                                                                                           | https://github.com/mmorise/ita-corpus                             |
| CMU ARCTIC の読み上げ文 (同梱。JSON に変換)                          | 読み上げの学習用の文章 (英語)     | CMU ARCTIC のライセンス ([third_party/cmu-arctic/LICENSE.txt](third_party/cmu-arctic/LICENSE.txt)) | http://www.festvox.org/cmu_arctic/                                |
