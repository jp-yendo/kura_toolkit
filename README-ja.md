# Kura Toolkit

## 1. システム概要

Kura Toolkit は、音声・動画・画像の処理とファイルの整理を 1 つにまとめたデスクトップアプリケーションです。ダッシュボードとタイトルバーのメニューから各機能を開けます。

### オーディオ: オーディオ正規化

- 音声ファイル (WAV・MP3・AAC・M4A・FLAC・Ogg・Opus・AIFF・WMA など) の音量 (ラウドネス) を測り、目標の大きさにそろえて保存できます
- 曲全体の音量を同じだけ変えるため、曲の中の強弱は変わりません
- 元の形式のまま保存するか、MP3・FLAC・Ogg Vorbis・Opus・AAC・WAV・ALAC から形式を選べます (形式ごとにサンプリング周波数やビットレートなども選べます)
- タグとアルバムアートを引き継ぎます (アルバムアートを入れられない形式を除く)

### オーディオ: 音声分離・加工

- 曲や音声を、ボーカルと伴奏、楽器ごと (ドラム・ベース・ギター・ピアノなど)、メインボーカルとコーラスなどに分離できます
- 残響・エコーやノイズを除去したり、無音部分の雑音を消したり、音量をそろえたりできます (分離せずに使うこともできます)
- 方式やモデルを変えた結果を聞き比べて、使うものを選べます
- 結果をさらに分離・加工できます (例: ボーカル → メインとコーラス → 残響の除去)
- 選んだ結果を MP3・FLAC・Ogg Vorbis・Opus・AAC・WAV・ALAC で書き出せます

### オーディオ: 音声変換

- 歌声や話し声を、選んだ声のモデルの声に変換できます
- 曲ではボーカルだけを変換し、音量バランスやリバーブを調整して伴奏と合成できます
- キーを変えると、伴奏も同じだけ移調します
- 残響・エコーやノイズを除去したり、無音部分の雑音を消したりしながら変換できます
- 設定を変えた結果を聞き比べて、使うものを選べます
- 選んだ結果を MP3・FLAC・Ogg Vorbis・Opus・AAC・WAV・ALAC で書き出せます
- 声のモデルの取り込み・書き出しと、Hugging Face でのモデルの検索ができます
- アプリでの録音や音声ファイルから、自分の声のモデルを作れます

### オーディオ: 読み上げ

- 文章を、選んだ声で読み上げられます (日本語・英語・中国語)
- 行ごとに開始時間と終了時間を指定して読み上げられます (SRT・WebVTT・ASS・SSA・SBV の字幕ファイルを開けます)
- 制御タグで、間・話速・音の高さ・音量・読みを指定できます
- 読み上げた音声を MP3・FLAC・Ogg Vorbis・Opus・AAC・WAV・ALAC で書き出せます
- 声のモデルのダウンロード・取り込み・書き出しができます
- 提示される文や好きな文を読み上げた録音・音声ファイルから、自分の声のモデルを作れます (NVIDIA GPU を搭載した Windows・Linux)

### 音声機能のダウンロード

音声分離・加工、音声変換、読み上げを使うには、必要なもの (Python・パッケージ・モデル) をアプリからダウンロードします。各画面の「ダウンロード管理」から、必要なものを選んでダウンロードできます。ダウンロードする前に容量が表示されます。

### 動画: チャプターカット

- 動画のチャプターの一覧と、ファイルの情報 (映像・音声などのストリーム) を確認できます
- チャプターの範囲を指定して切り出せます
- 指定したチャプターの位置で、複数のファイルに分割できます
- 再エンコードせずに速く処理するか、再エンコードしてチャプターの位置で正確に切るかを選べます

### 画像: SVG 変換

- 画像 (PNG・JPEG・BMP・GIF・TIFF) をベクター形式の SVG に変換できます
- 変換の設定を調整し、元の画像と並べて確認してから保存できます

### ツール: クリーンアップ

- Zone.Identifier・Thumbs.db・.DS_Store などの不要なファイルを探して削除できます
- 探すものの種類と、探す場所 (ホームディレクトリ・ドライブ・任意のフォルダ) を選べます
- 見つかったファイルはゴミ箱へ移します (Windows の Zone.Identifier はゴミ箱へ移せないため、そのまま削除します)

macOS では、デスクトップ・書類・ダウンロードなどのフォルダを探すために「フルディスクアクセス」の許可が必要です。許可していない場合は、クリーンアップの画面に案内が表示されます。

### アプリ設定

次の項目を設定できます。

- テーマ (ライト / ダーク / システム) と言語 (日本語 / 英語)
- 探索のスレッド数 (ディレクトリを探すときに並行して動かす数)
- ffmpeg / ffprobe の場所 (指定しない場合は自動で探します)
- 録音に使うマイクと入力ゲイン (マイクテストで確かめられます)
- 保存場所 (ライブラリ・モデル・キャッシュ・作業ディレクトリ) とキャッシュの保持期間

### 必要な外部ツール

オーディオ正規化・チャプターカット・音声機能 (音声分離・加工、音声変換、読み上げ) には [FFmpeg](https://ffmpeg.org/) が必要です。アプリには含まれていないため、別途インストールしてください。

- 音声変換のキーの変更 (オクターブ単位を除く) と、読み上げで時間を指定した行を話速を上げて収める場合 (既定) には、rubberband を含む FFmpeg が必要です (Windows は winget の Gyan.FFmpeg、macOS は Homebrew の `ffmpeg`、Linux はディストリビューションの `ffmpeg` など)
- 音声機能のダウンロードには、インターネット接続と数 GB の空き容量が必要です
- Windows: [Microsoft Visual C++ 再頒布可能パッケージ](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist) (x64。音声機能に必要)
- モデルの学習のための録音には、マイクの使用の許可が必要です (macOS では、求められたときにシステム設定で許可します)
- macOS: Xcode Command Line Tools (`xcode-select --install`。音声分離・加工に必要)
- Linux: C/C++ のコンパイラー (`build-essential` など。音声分離・加工に必要)

## 2. 対応OS

- Windows 10/11
- macOS 12 (Monterey) 以降
- Linux (Debian系/RHEL系)

音声分離・加工、音声変換、読み上げは、Windows 10/11 (x64)・Apple Silicon の macOS 14 以降・Linux (x64) で使えます。GPU (Windows と Linux は NVIDIA、macOS は Apple Silicon) があれば GPU を使い、無ければ CPU で処理します。

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
│   ├── services/          # 設定 (既定値を含む)・ジョブ管理・ffmpeg・各機能サービス
│   ├── workers/           # worker_threads のエントリ (ディレクトリ走査ワーカー)
│   └── utils/             # 各種ユーティリティ
├── python/                # 音声機能の Python スクリプト (ダウンロードした仮想環境で実行)
├── preload/               # renderer へ安全にAPIをブリッジ (window.kuraToolkit)
├── renderer/              # React + MUI UI (pages/stores/components/i18n)
└── shared/                # main と renderer が共有する型定義・IPC チャンネル定数・音声機能の文章の解析
public/                    # アイコン等
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

音声機能は次のコンポーネントを利用します。学習用の文章を除き、アプリには同梱していません。利用者がダウンロードを開始したときだけ各配布元から取得し、版はアプリが固定しています (UVR のモデル設定ファイルと NLTK のデータは、配布元がブランチでしか公開していないため、ブランチの URL から取得します)。各項目のライセンスと取得元は「ダウンロード管理」にも表示されます。

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
| chinese-roberta-wwm-ext-large                                        | 読み上げ (中国語 BERT)            | Apache-2.0                                                                                                   | https://huggingface.co/hfl/chinese-roberta-wwm-ext-large          |
| NLTK のデータ: CMUdict、averaged_perceptron_tagger                   | 読み上げ (英語の発音推定)         | CMUdict: 用途を問わず利用可 (Carnegie Mellon University) / tagger: MIT                                       | https://github.com/nltk/nltk_data                                 |
| Style-Bert-VITS2 JP-Extra の事前学習モデル                           | 読み上げの学習                    | AGPL-3.0                                                                                                     | https://huggingface.co/litagin/Style-Bert-VITS2-2.0-base-JP-Extra |
| Style-Bert-VITS2 の事前学習モデル (Bert-VITS2 2.1 の事前学習モデル)  | 読み上げの学習                    | モデルカードに記載なし。Bert-VITS2 (AGPL-3.0) 由来                                                           | https://huggingface.co/litagin/Style-Bert-VITS2-1.0-base          |
| WavLM Base+                                                          | 読み上げの学習 (JP-Extra)         | CC BY-SA 3.0                                                                                                 | https://huggingface.co/microsoft/wavlm-base-plus                  |
| wespeaker-voxceleb-resnet34-LM                                       | 読み上げの学習 (スタイルベクトル) | CC BY 4.0                                                                                                    | https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM    |
| pyannote.audio                                                       | 読み上げの学習                    | MIT                                                                                                          | https://github.com/pyannote/pyannote-audio                        |
| JVNV の声のモデル                                                    | 読み上げの声のモデル              | CC BY-SA 4.0 (JVNV コーパスから継承)                                                                         | https://huggingface.co/litagin/style_bert_vits2_jvnv              |
| ITA コーパス (同梱)                                                  | 読み上げの学習用の文章 (日本語)   | パブリックドメイン                                                                                           | https://github.com/mmorise/ita-corpus                             |
| CMU ARCTIC の読み上げ文 (同梱。JSON に変換)                          | 読み上げの学習用の文章 (英語)     | CMU ARCTIC のライセンス ([third_party/cmu-arctic/LICENSE.txt](third_party/cmu-arctic/LICENSE.txt)) | http://www.festvox.org/cmu_arctic/                                |
| Common Voice の中国語の文 (同梱。400 文を選択)                       | 読み上げの学習用の文章 (中国語)   | CC0 1.0 ([third_party/common-voice-zh/LICENSE.txt](third_party/common-voice-zh/LICENSE.txt)) | https://github.com/common-voice/common-voice                      |
