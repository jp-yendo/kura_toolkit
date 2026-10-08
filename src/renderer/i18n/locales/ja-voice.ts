// 音声分離・加工、音声変換、読み上げ (日本語)
export default {
    common: {
        back: '戻る',
        next: '次へ',
        ok: 'OK',
        save: '保存',
        discard: '破棄する',
        retry: '再試行',
        loading: '読み込み中',
        cancelled: 'キャンセルされました。',
        newWork: '新しい作業',
        newWorkConfirm:
            '現在の作業 (候補などの結果) を破棄して、新しい作業を始めます。書き出していない結果は失われます。よろしいですか？',
        listSeparator: '、',
        waitingGpu: '他の処理が終わるのを待っています (モデルの学習中は長くかかることがあります)',
        deleteCandidate: '候補を削除',
        on: 'オン',
        off: 'オフ',
    },
    sections: {
        convert: '変換',
        read: '読み上げ',
        models: '声のモデル',
        training: 'モデルの学習',
    },
    features: {
        separation: '音声分離・加工',
        conversion: '音声変換',
        conversionTraining: '音声変換のモデルの学習',
        tts: '読み上げ',
        ttsTraining: '読み上げのモデルの学習',
    },
    modelType: {
        'jp-extra': 'JP-Extra 版',
        multilingual: '多言語版',
    },
    languages: {
        ja: '日本語',
        en: '英語',
        zh: '中国語',
    },
    platform: {
        unsupportedTitle: 'この環境では音声機能を利用できません',
        unsupported: {
            os: '音声分離・加工、音声変換、読み上げは Windows・macOS・Linux で利用できます。',
            arch: '音声分離・加工、音声変換、読み上げは 64bit 版 Windows (x64)・Apple Silicon の Mac・64bit 版 Linux (x64) で利用できます。音声機能が使うライブラリが Intel 版 Mac と Arm 版の Windows・Linux に対応していないためです。',
            macosVersion:
                'macOS 14 (Sonoma) 以降が必要です。音声機能が使うライブラリが macOS 13 以前に対応していないためです。',
        },
        cuda: 'NVIDIA GPU ({{name}})',
        mps: 'Apple Silicon の GPU',
        cpu: 'CPU (GPU を使えないため、処理に時間がかかります)',
    },
    readiness: {
        title: 'ダウンロードが必要です',
        message: 'この機能を使うには、次のものをダウンロードしてください。',
        openLibrary: 'ダウンロード管理',
    },
    player: {
        play: '再生',
        pause: '一時停止',
        stop: '停止',
        position: '再生位置',
    },
    library: {
        title: '音声機能のダウンロード',
        open: 'ダウンロード管理',
        libraryDir: 'ライブラリ',
        modelDir: 'モデル',
        changeInSettings: '設定で変更',
        redetect: '再検出',
        vcRuntimeMissing:
            'Microsoft Visual C++ 再頒布可能パッケージが見つかりません。音声機能に必要なため、インストールしてからパッケージ一式をダウンロードしてください。',
        vcRuntimeOpen: '入手先を開く',
        driverUpdate:
            'NVIDIA GPU のドライバーが古いため、GPU を使えません。ドライバーを更新すると GPU で処理できるようになります (更新後は「再検出」を押してください)。',
        nonAsciiPath:
            '保存場所に半角英数字以外の文字が含まれているため、正しく動かないことがあります。アプリ設定で半角英数字だけの場所に変更することをおすすめします。',
        requirements: {
            separationRuntime: '分離の実行環境',
            separatorModels: '分離モデル',
            conversionRuntime: '変換の実行環境と補助モデル',
            conversionExtras: '追加の機能用',
            whenFcpe: 'ピッチ抽出方式に FCPE を選ぶ場合に必要',
            whenSeparateInput:
                '変換の画面で、入力の音源からボーカルを分離する場合に必要 (分離モデルは「音声分離・加工」のタブで選びます)',
            importedEmbedders: '取り込んだ声のモデル用',
            importedEmbeddersNote:
                '取り込んだ声のモデルが ContentVec 以外の方式で作られている場合に、その方式のモデルが 1 つ必要です。どの方式かは「声のモデル」の一覧に表示されます。変換する声の言語とは関係ありません。アプリで学習した声には不要です。',
            conversionTrainingRuntime: '学習の実行環境と補助モデル',
            ttsRuntime: '読み上げの実行環境',
            ttsLanguageModels: '読み上げる言語の言語モデル',
            ttsLanguageModelsNote:
                '読み上げる文章の言語の言語モデルが必要です。日本語・英語・中国語の文章は、それぞれの言語の言語モデルで解析します (声のモデルの形式によらず同じです)。各言語モデルの下には、その言語を読めるすぐに使えるモデルを並べています。',
            whenJapanese: '日本語を読み上げる場合に必要 (JP-Extra 版・多言語版のどちらの声でも使います)',
            whenEnglish: '英語を読み上げる場合に必要',
            whenChinese: '中国語を読み上げる場合に必要',
            ttsTrainingRuntime: '学習の実行環境',
            trainingFormat: '学習する形式ごとのモデル',
            trainingFormatNote: '学習の画面で選ぶ形式 (JP-Extra 版・多言語版) の事前学習モデルが必要です。',
            whenTrainJpExtra: 'JP-Extra 版で学習する場合に必要',
            whenTrainMultilingual: '多言語版で学習する場合に必要',
            whenTrainEnglish: '英語の声を学習する場合に必要',
            whenTrainChinese: '中国語の声を学習する場合に必要',
            whenTrainJapanese: '日本語の声を学習する場合に必要',
            trainingLanguageModels: '学習する言語の言語モデル',
            trainingLanguageModelsNote: '学習に使う文章の言語の言語モデルが必要です。',
            readyModelOption: 'すぐに使えるモデル (オプション)',
        },
        groupTitle: '{{name}} ({{kind}})',
        requirementKinds: {
            all: '必須',
            anyOf: 'いずれか 1 つ以上',
            optional: 'オプション',
        },
        separatorArch: '方式: {{arch}}',
        separatorOutputs: '出力: {{outputs}}',
        separatorRecommendations: '目的別のおすすめ',
        separatorSingleModels: '個別のモデル',
        separatorNoMatch: '条件に合うモデルはありません。',
        separatorEnsemblePartial: '{{installed}} / {{total}} 個取得済み',
        separatorEnsembleDescriptions: {
            instrumental_clean: '伴奏にボーカルが混ざるのを、最も抑えることを狙った組み合わせです。',
            instrumental_full: '楽器の音を、できるだけ残すことを狙った組み合わせです。',
            instrumental_balanced: 'ノイズの少なさと、楽器の音の厚みの釣り合いを取った組み合わせです。',
            instrumental_low_resource: 'GPU のメモリが少ない環境向けの、速く動く組み合わせです。',
            vocal_balanced: 'ボーカルの品質が、全体として最も高くなることを狙った組み合わせです。',
            vocal_clean: 'ボーカルに楽器の音が混ざるのを、最も抑えることを狙った組み合わせです。',
            vocal_full: 'ハーモニーまで含めて、ボーカルをできるだけ残すことを狙った組み合わせです。',
            vocal_rvc: '音声変換 (RVC) などの学習に使う声を作ることに向けた組み合わせです。',
            karaoke:
                'メインボーカルを分ける、3 つのモデルの組み合わせです。単体のモデルより分離の品質 (SDR) が高くなります (約 10.6。単体は約 10.2)。',
        },
        separatorPurposes: {
            vocals: { title: 'ボーカル取り出し' },
            accompaniment: { title: '伴奏取り出し' },
            both: { title: 'ボーカルと伴奏の両方' },
            denoise: { title: 'ノイズ除去' },
            dereverb: { title: '残響・エコーの除去' },
            layers: {
                title: 'メイン・コーラス・伴奏の分割',
                note: '1 つの組み合わせではできないため、2 回に分けて分離します。1 回目でボーカルと伴奏に分け、分離の画面で、分けたボーカルの「分岐」から 2 回目を行い、メインボーカルとバックコーラスに分けます。両方の組み合わせが必要です。',
            },
        },
        separatorPurposeLabels: {
            step1: '1 回目: ボーカルと伴奏に分ける',
            step2: '2 回目: ボーカルをメインボーカルとバックコーラスに分ける',
        },
        separatorModelNotes: {
            m_10_SP_UVR_2B_32000_1:
                '少ない計算で動く、旧来の標準精度版 (SP) のモデルです。扱う帯域が狭く (高音は約 16 kHz まで)、新しいモデルより品質は劣ります。',
            m_11_SP_UVR_2B_32000_2:
                '少ない計算で動く、旧来の標準精度版 (SP) のモデルです。扱う帯域が狭く (高音は約 16 kHz まで)、新しいモデルより品質は劣ります。',
            m_12_SP_UVR_3B_44100:
                '少ない計算で動く、旧来の標準精度版 (SP) のモデルです。新しいモデルより品質は劣ります。',
            m_13_SP_UVR_4B_44100_1:
                '少ない計算で動く、旧来の標準精度版 (SP) のモデルです。抽出が控えめで、ボーカルが残りやすくなります。',
            m_14_SP_UVR_4B_44100_2:
                '少ない計算で動く、旧来の標準精度版 (SP) のモデルです。抽出が控えめで、ボーカルが残りやすくなります。',
            m_15_SP_UVR_MID_44100_1:
                '少ない計算で動く、旧来の標準精度版 (SP) のモデルです。明瞭さは劣りますが、ノイズは少なめです。',
            m_16_SP_UVR_MID_44100_2:
                '少ない計算で動く、旧来の標準精度版 (SP) のモデルです。明瞭さは劣りますが、ノイズは少なめです。',
            m_17_HP_Wind_Inst_UVR:
                '木管楽器 (フルート・サックスなど) と、それ以外の音に分けるモデルです。先に伴奏を取り出してから使います。弦楽器を木管楽器として拾うことがあります。',
            m_1_HP_UVR:
                '伴奏を取り出すことを主にした高精度版 (HP) のモデルです。安定した結果になり、2_HP よりドラムを強めに残します。',
            m_2_HP_UVR:
                '伴奏を取り出すことを主にした高精度版 (HP) のモデルです。1_HP よりかなり速く、くっきりした音になりますが、ボーカルが残りやすくなります。',
            m_3_HP_Vocal_UVR: 'ボーカルを取り出すことを主にした高精度版 (HP) のモデルです。',
            m_4_HP_Vocal_UVR: 'ボーカルを取り出すことを主にした高精度版 (HP) のモデルです。',
            m_5_HP_Karaoke_UVR:
                'メインボーカルを取り除き、バックコーラスを伴奏側に残すモデルです。曲全体より、先に取り出したボーカルにかけた方がうまくいきます。新しいモデルより品質は劣ります。',
            m_6_HP_Karaoke_UVR:
                'メインボーカルを取り除き、バックコーラスを伴奏側に残すモデルです。曲全体より、先に取り出したボーカルにかけた方がうまくいきます。新しいモデルより品質は劣ります。',
            m_7_HP2_UVR:
                '伴奏を取り出す大型 (HP2) のモデルです。VR のモデルの中でボーカルが最も残りにくい代わりに、伴奏の厚みが減り、高音も弱くなります。処理はとても遅いモデルです。',
            m_8_HP2_UVR:
                '9_HP2 を軽く調整した大型 (HP2) のモデルです。単体では 9_HP2 に劣ることが多く、組み合わせ (アンサンブル) の相手に向きます。',
            m_9_HP2_UVR:
                '伴奏を取り出す大型 (HP2) のモデルです。いろいろな曲で最も安定した結果になります。処理が重いモデルです。',
            m_aspiration_mel_band_roformer_less_aggr_sdr_18_1201:
                'ボーカルから息の音 (ブレス) を分けるモデルの、控えめに分ける版です。',
            m_aspiration_mel_band_roformer_sdr_18_9845:
                'ボーカルから息の音 (ブレス) を分けるモデルで、ミックスの作業向けです。息以外の音も多めに取ります。',
            m_BS_Roformer_SW:
                'ボーカル・ドラム・ベース・ギター・ピアノ・その他の 6 つに分けるモデルです。ボーカル以外のパートは単体のモデルで最高水準の品質で、ギターとピアノに特に強い一方、打楽器的な音はすべてドラムに入り、指を鳴らす音や足踏みをボーカルに入れることがあります。',
            m_bs_roformer_instrumental_resurrection_gabox:
                '伴奏を取り出す Resurrection のモデルを、厚みを増すよう調整した版 (Inst V1e なみ) です。',
            m_bs_roformer_instrumental_resurrection_unwa:
                '伴奏を取り出す小型で速いモデルです。厚みは Inst V1e と V1e Plus の間で、伴奏へのボーカルの混ざりを抑えますが、V1e Plus よりこもり気味です。',
            m_bs_roformer_karaoke_anvuew:
                'メインボーカルと、それ以外 (バックコーラスと伴奏) に分けるモデルです。メインボーカルが厚く明るい一方、メインボーカルが伴奏側に漏れることがあります。先にボーカルだけを取り出してから使うと防げます。',
            m_bs_roformer_karaoke_frazer_becruily:
                'メインボーカルと、それ以外 (バックコーラスと伴奏) に分けるモデルです。ハーモニーの区別が特に上手で、アドリブや複数のメインボーカルはメイン側になります。ラジオのような加工をした声は取りこぼすことがあります。',
            m_bs_roformer_male_female_by_aufr33_sdr_7_2889:
                '声を、男性の声と女性の声に分ける試験版 (ベータ) のモデルです。先にボーカルだけを取り出してから使います。',
            m_bs_roformer_vocals_gabox: 'ボーカルを取り出すモデルです。公開されている説明は見つかりませんでした。',
            m_bs_roformer_vocals_resurrection_unwa:
                'ボーカルを取り出す小型のモデルで、混ざりにくさと品質がどちらも高い水準です。',
            m_bs_roformer_vocals_revive_unwa:
                'ボーカルを取り出すモデル (BS-Roformer 1297 の調整版) で、ボーカルへの楽器の混ざりが少なくなっています。試験的なモデルです。',
            m_bs_roformer_vocals_revive_v2_unwa:
                'ボーカルへの楽器の混ざりにくさが、公開されているボーカルのモデルの中で最も高い版です。処理は遅めです。',
            m_bs_roformer_vocals_revive_v3e_unwa:
                'ボーカルの厚みを最大限に重視した版です。ハーモニーの扱いに難があり、ノイズが乗りやすくなります。',
            m_denoise_mel_band_roformer_aufr33_aggr_sdr_27_9768:
                'ノイズを強めに取り除く版です。スネアなど、曲の一部まで消すことがあります。',
            m_denoise_mel_band_roformer_aufr33_sdr_27_9959:
                'ノイズを取り除くモデルで、VR の DeNoise より控えめです。歓声の除去にも使えます。',
            m_dereverb_echo_mel_band_roformer_sdr_10_0169:
                '残響とエコー (ディレイ) をまとめて取り除くモデルです (ボーカル専用)。ハーモニーの一部も取り除きます。',
            m_dereverb_echo_mel_band_roformer_sdr_13_4843_v2:
                '残響とエコーを取り除くモデル (V1) を、多くの曲で学習し直した改良版です (ボーカル専用)。ハーモニーの多くも取り除きます。',
            m_dereverb_big_mbr_ep_362:
                '大きな残響を取り除くモデルです (ボーカル専用)。ハーモニーの多くも取り除きます。',
            m_dereverb_echo_mbr_fused:
                'V2・Big・Super Big を 1 つに合わせた版で、小さな残響と大きな残響を同時に取り除けます (ボーカル専用)。作者が勧めている版です。',
            m_dereverb_mel_band_roformer_anvuew_sdr_19_1729:
                'ボーカルの残響を強めに取り除くモデルです (ボーカル専用)。出力がモノラル寄りになり、中央にないハーモニーや楽器の残りも取り除きます。',
            m_dereverb_mel_band_roformer_less_aggressive_anvuew_sdr_18_8050:
                'ボーカルの残響を取り除くモデルの控えめな版です (ボーカル専用)。ステレオのボーカルや、重ねたボーカル向けに選ばれています。',
            m_dereverb_mel_band_roformer_mono_anvuew:
                'ボーカルの残響を取り除くモデルで、取り除く力がより強い版です (ボーカル専用)。モノラルや話し声にも使えますが、楽器の残りやハーモニーを取り除く働きは弱くなっています。',
            m_dereverb_super_big_mbr_ep_346:
                '非常に大きな残響向けのモデルで、使う場面は限られます (ボーカル専用)。ハーモニーの多くも取り除きます。',
            m_deverb_bs_roformer_8_384dim_10depth:
                'ボーカルの残響を取り除くモデルです。中央にないハーモニーや声の効果も取り除くため、1 人の歌声や話し声に向き、合唱には向きません。エコーが少し残ることがあります。',
            m_hdemucs_mmi:
                'ボーカル・ドラム・ベース・その他の 4 つに分ける、1 つ前の世代 (Hybrid Demucs) のモデルです。Demucs の中で最も速い一方、品質は劣ります。',
            m_htdemucs:
                'ボーカル・ドラム・ベース・その他の 4 つに分ける、Demucs v4 の既定のモデルです。標準の学習用データ (MusDB) に加え、800 曲で学習されています。',
            m_htdemucs_6s:
                'ボーカル・ドラム・ベース・ギター・ピアノ・その他の 6 つに分けるモデルです。ギターはまずまずですが、ピアノは品質が低く、4 つに分けるモデルより全体に混ざりやすくなります。',
            m_htdemucs_ft:
                'Demucs v4 の既定のモデルを調整した版で、4 つに分けます。処理に約 4 倍の時間がかかる代わりに、少し良くなる場合があります。',
            m_Kim_Inst:
                '伴奏を取り出すモデルです。Inst 3 よりきれいで品質も高い一方、ノイズは多めです。高音は約 17.7 kHz までです。',
            m_Kim_Vocal_1: 'ボーカルを取り出すモデルです。',
            m_Kim_Vocal_2:
                'ボーカルを取り出すモデルで、Kim Vocal 1 より新しい版です。高音に上限があり、ノイズが出ることがあります。',
            m_kuielab_a_bass:
                '2021 年の音楽の分離の競技会 (Music Demixing Challenge) の上位のモデル (KUIELab) で、ベースとそれ以外に分けます。決められた学習用のデータだけで学習する部門 (A) の版で、この部門で 2 位でした。',
            m_kuielab_a_drums:
                '2021 年の音楽の分離の競技会 (Music Demixing Challenge) の上位のモデル (KUIELab) で、ドラムとそれ以外に分けます。決められた学習用のデータだけで学習する部門 (A) の版で、この部門で 2 位でした。',
            m_kuielab_a_other:
                '2021 年の音楽の分離の競技会 (Music Demixing Challenge) の上位のモデル (KUIELab) で、ボーカル・ドラム・ベース以外の楽器を分けます。決められた学習用のデータだけで学習する部門 (A) の版で、この部門で 2 位でした。',
            m_kuielab_a_vocals:
                '2021 年の音楽の分離の競技会 (Music Demixing Challenge) の上位のモデル (KUIELab) で、ボーカルとそれ以外に分けます。決められた学習用のデータだけで学習する部門 (A) の版で、この部門で 2 位でした。',
            m_kuielab_b_bass:
                '2021 年の音楽の分離の競技会 (Music Demixing Challenge) の上位のモデル (KUIELab) で、ベースとそれ以外に分けます。ほかのデータも使って学習できる部門 (B) の版で、この部門で 3 位でした。速い一方、品質は並みです。',
            m_kuielab_b_drums:
                '2021 年の音楽の分離の競技会 (Music Demixing Challenge) の上位のモデル (KUIELab) で、ドラムとそれ以外に分けます。ほかのデータも使って学習できる部門 (B) の版で、この部門で 3 位でした。速い一方、品質は並みです。',
            m_kuielab_b_other:
                '2021 年の音楽の分離の競技会 (Music Demixing Challenge) の上位のモデル (KUIELab) で、ボーカル・ドラム・ベース以外の楽器を分けます。ほかのデータも使って学習できる部門 (B) の版で、この部門で 3 位でした。速い一方、品質は並みです。',
            m_kuielab_b_vocals:
                '2021 年の音楽の分離の競技会 (Music Demixing Challenge) の上位のモデル (KUIELab) で、ボーカルとそれ以外に分けます。ほかのデータも使って学習できる部門 (B) の版で、この部門で 3 位でした。速い一方、品質は並みです。',
            m_MDX23C_8KFFT_InstVoc_HQ:
                'ボーカルと伴奏に分ける、高音まで扱えるモデルです。多くの曲で良い結果になり、声の質をよく取り戻しますが、伴奏にボーカルが残りやすく、息の音が消えることがあります。',
            m_MDX23C_De_Reverb_aufr33_jarredou:
                'ボーカルの残響を取り除くモデルです。部屋の響きまで拾い、VR の残響除去よりきれいですが、音が詰まったように不自然になることがあります。合唱やバックコーラスにも向きます。',
            m_MDX23C_DrumSep_aufr33_jarredou:
                'ドラムを、キック・スネア・タム・ハイハット・ライド・クラッシュの 6 つに分けるモデルです。先にドラムだけを取り出してから使います。キック・スネア・タムはきれいに分かれますが、ライド・ハイハット・クラッシュの区別は苦手です。',
            m_mel_band_roformer_bleed_suppressor_v1:
                '取り出した伴奏に残ったボーカルなどの混ざりを取り除くモデルです。伴奏 (Inst V1 や V1e など) を取り出した後に使います。',
            m_mel_band_roformer_crowd_aufr33_viperx_sdr_8_7144:
                'ライブ音源の歓声を取り除くモデルです。MDX-Net の歓声のモデルより楽器やボーカルをよく残す代わりに、歓声が少し残ります。',
            m_mel_band_roformer_denoise_debleed_gabox:
                '厚みを重視した伴奏のモデルで出るノイズを取り除くモデルです。ボーカルの残りは取り除けません。先に曲全体にかけてから伴奏のモデル (INSTV6N など) を使うと、きれいで厚みのある結果になります。',
            m_mel_band_roformer_instrumental_2_gabox:
                '伴奏を取り出す基本のモデルの 2 版目で、厚みと混ざりにくさの釣り合いを取っています。',
            m_mel_band_roformer_instrumental_3_gabox:
                '伴奏を取り出す基本のモデルの 3 版目です。厚みは控えめで、ノイズが多めになり、ボーカルが少し残ることがあります。',
            m_mel_band_roformer_instrumental_becruily:
                '伴奏を取り出すモデルで、Inst V1 なみにきれいでノイズが少なく、ボイスチョップも残せます。ローパスをかけたボーカルは苦手です。',
            m_mel_band_roformer_instrumental_bleedless_v1_gabox:
                '伴奏へのボーカルの混ざりにくさ (B) を重視した版の 1 版目です。',
            m_mel_band_roformer_instrumental_bleedless_v2_gabox:
                '伴奏へのボーカルの混ざりにくさ (B) を重視した版です。',
            m_mel_band_roformer_instrumental_bleedless_v3_gabox:
                '伴奏へのボーカルの混ざりにくさ (B) を、B の版の中で最も重視した版です。こもることがあります。',
            m_mel_band_roformer_instrumental_fullness_noise_v4_gabox:
                'Fullness V4 より、さらに厚みを増した代わりに、ノイズがかなり多い版です。',
            m_mel_band_roformer_instrumental_fullness_v1_gabox: '伴奏の厚み (F) を重視した版の 1 版目です。',
            m_mel_band_roformer_instrumental_fullness_v2_gabox: '伴奏の厚み (F) を重視した版です。',
            m_mel_band_roformer_instrumental_fullness_v3_gabox:
                '伴奏の厚み (F) を重視した版で、Inst V1e なみの厚みがありながら、ボーカルの混ざりは少なめです。サックスをボーカル側に取ってしまうことがあります。',
            m_mel_band_roformer_instrumental_fullness_v4_gabox:
                '伴奏の厚み (F) を重視した版で、厚みがありながらノイズは多すぎません。曲によってはボーカルが混ざりやすくなります。',
            m_mel_band_roformer_instrumental_fv7z_gabox:
                '伴奏へのボーカルの混ざりにくさがとても高く、ノイズがほとんどない版です。曲によっては、ボーカルの残響やノイズが残ります。',
            m_mel_band_roformer_instrumental_fv8_gabox:
                '伴奏へのボーカルの混ざりにくさを重視した版で、厚みはやや減っています。',
            m_mel_band_roformer_instrumental_fv8b_gabox:
                'Inst V1e Plus よりこもる代わりに、きれいな版です。ボイスチョップも残します。',
            m_mel_band_roformer_instrumental_fvx_gabox: 'INSTV7 と Instrumental 3 の中間にあたる版です。',
            m_mel_band_roformer_instrumental_gabox:
                '伴奏を取り出す基本のモデルで、厚みと混ざりにくさの釣り合いを取っています。',
            m_mel_band_roformer_instrumental_instv5_gabox: '伴奏の厚みを重視した系統 (INSTV) の版です。',
            m_mel_band_roformer_instrumental_instv5n_gabox:
                'INSTV5 の、ノイズが増える代わりに厚みを増した版 (N) です。',
            m_mel_band_roformer_instrumental_instv6_gabox:
                'INSTV の版で、becruily と unwa のモデルの特徴を合わせています。Inst V1e より楽器をボーカルと取り違えにくい一方、厚みは劣ります。',
            m_mel_band_roformer_instrumental_instv6n_gabox:
                'INSTV6 の、ノイズが増える代わりに厚みを大きく増した版 (N) です。先に Denoise-Debleed をかけてから使うと、きれいな結果になります。',
            m_mel_band_roformer_instrumental_instv7_gabox:
                'INSTV の版で、厚みがある代わりにノイズが多めです。ボーカルが残ったり、一部の楽器が消えたりすることがあります。',
            m_mel_band_roformer_instrumental_instv7n_gabox:
                'INSTV7 の、ノイズが増える代わりに厚みを増した版 (N) です。',
            m_mel_band_roformer_instrumental_instv8_gabox:
                'INSTV7 より厚みは減る代わりに、ボーカルの残りとノイズが少ない版です。',
            m_mel_band_roformer_instrumental_instv8n_gabox:
                'INSTV8 の N 版です。ボーカルが残りやすいという報告があります。',
            m_mel_band_roformer_karaoke_aufr33_viperx_sdr_10_1956:
                'メインボーカルと、それ以外 (バックコーラスと伴奏) に分けるモデルです。新しいモデルに品質で劣るものの、結果は安定しています。効果音も少し多めに取り除きます。',
            m_mel_band_roformer_karaoke_becruily:
                'メインボーカルと、それ以外 (バックコーラスと伴奏) に分けるモデルです。音が厚く、メインとバックの区別が上手ですが、2 人が同時に歌う部分は両方ともメインボーカルになります。先にボーカルだけを取り出してから使うことが勧められています。',
            m_mel_band_roformer_karaoke_gabox:
                'メインボーカルと、それ以外 (バックコーラスと伴奏) に分けるモデルです。メインボーカルはきれいですが、バックコーラス側は音が欠けやすくなります。',
            m_mel_band_roformer_karaoke_gabox_v2:
                'メインボーカルと、それ以外 (バックコーラスと伴奏) に分けるモデルの 2 版目で、品質は 1 版目とほぼ同じです。',
            m_mel_band_roformer_kim_ft2_bleedless_unwa:
                'Kim のボーカルのモデルの調整版のうち、ボーカルに楽器の音が混ざりにくいことを最も重視した版です。ノイズはとても少ない代わりに、こもりやすくなります。',
            m_mel_band_roformer_kim_ft2_unwa:
                'Kim のボーカルのモデルの調整版の 2 版目で、ボーカルへの楽器の混ざりにくさがさらに良くなっています。伴奏がこもることがあります。',
            m_mel_band_roformer_kim_ft3_unwa:
                'Kim のボーカルのモデルの調整版 (FT3 の先行版) で、管楽器がボーカルに混ざるのを減らすことを狙っています。',
            m_mel_band_roformer_kim_ft_unwa:
                'Kim のボーカルのモデルの調整版です。ボーカルの混ざりにくさと厚みが、どちらも元より良くなっています。伴奏側にはボーカルが残ることがあります。',
            m_mel_band_roformer_vocal_fullness_aname:
                'ボーカルの厚みを重視したモデルで、ノイズとの釣り合いも取れています。ボーカルのない部分に、かすかな声が残ることがあります。',
            m_mel_band_roformer_vocals_becruily:
                'ボーカルの厚みが高いモデルです。シャウトやデスボイスもきれいに取れますが、ボーカル側に残響を多めに取ることがあります。',
            m_mel_band_roformer_vocals_fv1_gabox: 'ボーカルの厚み (F) を重視した版の 1 版目です。',
            m_mel_band_roformer_vocals_fv2_gabox: 'ボーカルの厚み (F) を重視した版です。',
            m_mel_band_roformer_vocals_fv3_gabox: 'ボーカルの厚み (F) を重視した版です。',
            m_mel_band_roformer_vocals_fv4_gabox:
                'ボーカルの厚みを強く重視した版で、こもりのないきれいなボーカルになります。メインボーカルをよく取るので、音声変換 (RVC) の学習用の声づくりに向きますが、バックコーラスは苦手です。',
            m_mel_band_roformer_vocals_fv5_gabox:
                'FV4 より少し厚みのある版です。ボイスチョップ (細かく刻んだ声の素材) もボーカル側に残します。',
            m_mel_band_roformer_vocals_fv6_gabox:
                'ボーカルの厚みを最も重視した試験的な版です。バックコーラスもよく拾いますが、楽器をボーカルと取り違えることがあり、混ざりやすくなります。',
            m_mel_band_roformer_vocals_fv7b_gabox:
                'FV4 を改良した版で、混ざりにくさが上がり、バックコーラスもよく拾います。FV4 よりノイズが多く、シンセや楽器の一部が混ざることがあります。',
            m_mel_band_roformer_vocals_gabox: 'ボーカルを取り出すモデルの初期の版です。',
            m_mel_band_roformer_vocals_v2_gabox: 'ボーカルを取り出すモデルの初期の版 (2 版目) です。',
            m_melband_roformer_big_beta4:
                'ボーカルを取り出す大型のモデルです。明瞭で厚みのあるボーカルになり、音声変換 (RVC) の学習用の声づくりにも向きます。シンセが混ざることがあります。',
            m_melband_roformer_big_beta5e:
                'ボーカルの厚みを強く重視した大型のモデルです。ささやき声にも強い一方、伴奏が大きいとザラついたノイズが乗りやすくなります。音声変換の学習用の声づくりには Beta 4 が向きます。',
            m_melband_roformer_big_beta6:
                'ボーカルへの楽器の混ざりにくさを重視した、控えめな大型のモデルです。Beta 5e のノイズの問題がない代わりに、厚みは減り、こもり気味です。',
            m_melband_roformer_big_beta6x:
                '最も大きい Mel-Roformer のボーカルのモデルで、混ざりにくさを保ちつつ厚みも出します。バックコーラスもよく拾いますが、処理は遅く、ノイズが少し乗ります。',
            m_melband_roformer_inst_v1: '伴奏を取り出すモデルです。こもりが少ない一方、特有のノイズが残ります。',
            m_melband_roformer_inst_v1_plus: '伴奏を取り出すモデル (Inst V1) の改良版で、ノイズが減っています。',
            m_melband_roformer_inst_v1e:
                '伴奏の厚み (楽器の音の残り) を強く重視した版です。どの曲でも厚みが安定する一方、ノイズが多く、フルート・サックス・トランペットが苦手です。',
            m_melband_roformer_inst_v1e_plus:
                'Inst V1e の改良版です。ノイズが減った分、厚みは V1 と V1e の中間です。ボーカルの取り除き方は控えめです。',
            m_melband_roformer_inst_v2:
                'Inst V1 と同じ系統の大型版で、ボーカルの残りとノイズが少なくなっています。代わりにこもり気味で、フルートなどを取りこぼすことがあります。',
            m_melband_roformer_instvoc_duality_v1:
                'ボーカルと伴奏の両方を学習したモデルで、1 つで両方を取り出せます。ボーカルは Big Beta 4 に近い一方でノイズが多めです。伴奏はノイズが少ない代わりにこもり気味です。',
            m_melband_roformer_instvox_duality_v2:
                'ボーカルと伴奏の両方を取り出すモデル (Duality V1) の改良版で、品質がわずかに上がり、混ざりが少なくなっています。',
            m_MelBandRoformerBigSYHFTV1:
                'Kim のボーカルのモデルを調整した版で、ボーカルの厚みが増す代わりに、楽器が混ざりやすくなっています。',
            m_MelBandRoformerSYHFT:
                'Kim のボーカルのモデルを調整した試験版です。作者は、品質は耳で確かめるよう勧めています。',
            m_MelBandRoformerSYHFTV2_5: 'Kim のボーカルのモデルを調整した版です。新しいモデルに品質で劣ります。',
            m_MelBandRoformerSYHFTV2:
                'Kim のボーカルのモデルを調整した試験版の 2 版目です。作者は、品質は耳で確かめるよう勧めています。',
            m_MelBandRoformerSYHFTV3Epsilon:
                'Kim のボーカルのモデルを調整した版で、ボーカルがこもりにくくなっています。背景のノイズがボーカルに混ざることがあります。',
            m_MGM_HIGHEND_v4: '旧世代 (v4) のモデルで、高い音域を重視しています。',
            m_MGM_LOWEND_A_v4: '旧世代 (v4) のモデルで、低い音域を重視しています (32 kHz で学習)。',
            m_MGM_LOWEND_B_v4: '旧世代 (v4) のモデルで、低い音域を重視し、LOWEND_A と別の条件で学習されています。',
            m_MGM_MAIN_v4: '旧世代 (v4) の、ボーカルを取り除く主力のモデルです。多くの曲でボーカルをよく取り除けます。',
            m_model_bs_roformer_ep_317_sdr_12_9755:
                'ボーカルと伴奏に分ける初期の BS-Roformer のモデルで、1296 よりボーカルの品質が高い版です。単体では伴奏がこもりがちで、サックスは苦手です。',
            m_model_bs_roformer_ep_368_sdr_12_9628:
                'ボーカルと伴奏に分ける初期の BS-Roformer のモデルで、1297 より伴奏がわずかに良い版です。単体では伴奏がこもりがちで、サックスは苦手です。',
            m_model_bs_roformer_ep_937_sdr_10_5309:
                'ドラムとベースをまとめて、それ以外の音と分けるモデルです。ボーカルが残らないよう、先に伴奏を取り出してから使います。',
            m_model_chorus_bs_roformer_ep_267_sdr_24_1275:
                '合唱を、男声と女声に分ける試験的なモデルです (中国語の曲で学習)。男女が交互に歌う部分は分けられません。',
            m_model_mel_band_roformer_ep_3005_sdr_11_4360:
                'ボーカルと伴奏に分ける、最初の Mel-Roformer のモデルです。バックコーラスもボーカル側によく取りますが、処理は遅めです。',
            m_Reverb_HQ_By_FoxJoy:
                '残響を取り除くモデルです。ボーカルだけでなく曲全体にも使えますが、ステレオの音源で、中央にある音にしか効きません。アカペラでは歌を傷めたり、ディレイやピアノを消したりすることがあります。',
            m_UVR_BVE_4B_SN_44100_1:
                'ボーカルを、メインボーカルとバックコーラスに分けるモデルです。先にボーカルだけを取り出してから使います。バックコーラスが中央にある曲では、抽出の強さを 0 にします。',
            m_UVR_BVE_4B_SN_44100_2:
                'ボーカルを、メインボーカルとバックコーラスに分けるモデルです。先にボーカルだけを取り出してから使います。バックコーラスが中央にある曲では、抽出の強さを 0 にします。',
            m_UVR_De_Echo_Aggressive: 'エコーを、Normal 版より強く取り除くモデルです。',
            m_UVR_De_Echo_Normal:
                'エコーを取り除くモデルです。強く取り除く Aggressive 版より、うまくいく曲もあります。',
            m_UVR_De_Reverb_aufr33_jarredou:
                'ボーカルの残響を取り除くモデルです。MDX23C の De-Reverb より自然に聞こえる一方、残響が少し残ります。合唱やバックコーラスのあるボーカルにも向きます。',
            m_UVR_DeEcho_DeReverb:
                'エコーと残響をまとめて取り除くモデルです。モノラルの残響も取り除けるとされていますが、効きについては報告が分かれています。',
            m_UVR_DeNoise_Lite: 'ノイズを控えめに取り除くモデルです。楽器を傷めにくくなっています。',
            m_UVR_DeNoise:
                'ノイズを強めに取り除くモデルです。音がこもったり、シンセやベースが消えたりすることがあります。',
            m_UVR_MDX_NET_Inst_1: '伴奏を取り出すことを主にした初期のモデルです。高音は約 17.7 kHz までです。',
            m_UVR_MDX_NET_Inst_2: '伴奏を取り出すことを主にした初期のモデルです。高音は約 17.7 kHz までです。',
            m_UVR_MDX_NET_Inst_3:
                '伴奏を取り出すことを主にした初期のモデルです。こもり気味ですが、ノイズは少なめです。高音は約 17.7 kHz までです。',
            m_UVR_MDX_NET_Inst_HQ_1:
                '伴奏を取り出すことを主にした高品質版 (HQ) のモデルです。高音まで (約 22 kHz) 扱えます。',
            m_UVR_MDX_NET_Inst_HQ_2:
                '伴奏を取り出すことを主にした高品質版 (HQ) のモデルです。HQ_1 より、ボーカルを取り除き損ねる問題が少なくなっています。',
            m_UVR_MDX_NET_Inst_HQ_3:
                '伴奏を取り出すことを主にした高品質版 (HQ) のモデルです。強めに取り除き、フルートをボーカル側に取ってしまうことがあります。',
            m_UVR_MDX_NET_Inst_HQ_4:
                '伴奏を取り出すことを主にした高品質版 (HQ) のモデルで、HQ_3 を改良した版です。HQ の中で最もこもりにくい一方、フェードアウトにボーカルが残ることがあります。',
            m_UVR_MDX_NET_Inst_HQ_5:
                '伴奏を取り出すことを主にした高品質版 (HQ) のモデルです。ボーカルが残りにくい代わりに、こもり気味です。HQ の中で最も軽く速く、ボーカルの取り出しにも向きます。',
            m_UVR_MDX_NET_Inst_Main:
                '伴奏を取り出すことを主にした初期のモデルです。控えめに取り除く分、ボーカルが残りやすくなります。',
            m_UVR_MDX_NET_Voc_FT:
                'ボーカルを取り出すモデル (Kim Vocal) を調整した版です。いろいろな曲のボーカルに広く使えます。高音は約 17.7 kHz までです。',
            m_UVR_MDX_NET_Crowd_HQ_1:
                'ライブ音源の歓声を取り除くモデルです。歓声の多くを取り除けますが、楽器の音も歓声側に混ざりやすく、こもりがちです。',
            m_UVR_MDXNET_1_9703:
                'ボーカルを取り出す初期のモデルです (高音は約 14.7 kHz まで)。新しいモデルより品質は劣ります。',
            m_UVR_MDXNET_2_9682:
                'ボーカルを取り出す初期のモデルです (高音は約 14.7 kHz まで)。新しいモデルより品質は劣ります。',
            m_UVR_MDXNET_3_9662:
                'ボーカルを取り出す初期のモデルです (高音は約 14.7 kHz まで)。新しいモデルより品質は劣ります。',
            m_UVR_MDXNET_9482: 'ボーカルを取り出す、最も古い世代のモデルです。新しいモデルより品質は劣ります。',
            m_UVR_MDXNET_KARA:
                'メインボーカルを取り除き、バックコーラスを伴奏側に残すモデルです。強く取り除くため、バックコーラスも多く消えることがあります。バックコーラスが中央にある曲には、VR のカラオケのモデルが向きます。',
            m_UVR_MDXNET_KARA_2:
                'メインボーカルを取り除き、バックコーラスを伴奏側に残すモデルです。メインボーカルの細部をよく残し、きれいなメインボーカルになります。バックコーラスが中央にある曲には、VR のカラオケのモデルが向きます。',
            m_UVR_MDXNET_Main:
                'ボーカルを取り出す初期のモデルです。9703 のモデルより、ボーカルに伴奏が残りやすくなります。',
            m_vocals_mel_band_roformer:
                'ボーカルを取り出すモデルで、多くの調整版の元になっています。viperx のモデルよりこもりにくい一方、管楽器をボーカル側に取ったり、伴奏が残ったりすることがあります。',
        },
        prerequisites: '前提: {{items}} (選ぶと一緒にダウンロードされます)',
        selectMissing: '不足している項目を選択',
        missingRequired: '{{feature}}に必要な項目のうち、{{count}} 項目が未取得です。',
        colName: '名前',
        colSize: '容量',
        colStatus: '状態',
        colLicense: 'ライセンス・配布元',
        approx: '約 {{size}}',
        source: '配布元',
        credit: 'クレジット: {{credit}}',
        status: {
            missing: '未取得',
            installed: '取得済み',
            outdated: '更新が必要',
            broken: '再取得が必要',
        },
        progress: {
            waiting: '待機中',
            downloading: 'ダウンロード中',
            installing: '展開・インストール中',
            done: '完了',
            failed: '失敗',
            cancelled: '中断',
        },
        separatorCategoryCount: '{{name}} ({{count}})',
        separatorFilterArch: '方式',
        separatorFilterAll: 'すべて',
        separatorFilterRecommended: 'おすすめ',
        separatorRecommendedOnly: 'おすすめのみ',
        separatorRecommendedOthers: 'おすすめ以外',
        searchModels: '名前・説明・ライセンス・クレジットで検索',
        installedOnly: '取得済みのみ',
        separatorListHint: '「音声分離のパッケージ一式」をダウンロードすると、分離モデルの一覧が表示されます。',
        separatorListCreating: '分離モデルの一覧を作成しています…',
        separatorListFailed: '分離モデルの一覧を作成できませんでした: {{message}}',
        selection: '{{count}} 項目 (前提となる項目を含む) / 合計 {{size}}',
        selectionNone: 'ダウンロードまたは削除する項目を選んでください。',
        downloadSelected: '選択した項目をダウンロード',
        deleteSelected: '選択した項目を削除',
        delete: '削除',
        downloading: 'ダウンロード中',
        downloaded: 'ダウンロードが完了しました。',
        cancelled: 'ダウンロードを中断しました。もう一度ダウンロードすると、中断したところから再開します。',
        resultTitle: 'ダウンロードできなかった項目があります',
        resultMessage: '次の項目を取得できませんでした。再試行すると、これらの項目だけを取得し直します。',
        retry: '再試行',
        removeTitle: '削除の確認',
        removePythonWarning: 'Python 本体を削除すると、分離・変換・読み上げのパッケージ一式もすべて削除されます。',
        alsoRemovePython: 'Python 本体も削除する',
        removeAffects: '削除すると、再度ダウンロードするまで次の機能が使えなくなります: {{features}}',
        removeNote:
            'ダウンロードしたものは、再度ダウンロードすれば使えるようになります。学習・取り込みした声のモデルはここでは削除されません。',
        removed: '削除しました。',
        removeFailed: '{{count}} 項目を削除できませんでした。',
        ttsTrainingUnavailable: '読み上げのモデルの学習は、NVIDIA GPU を使える Windows と Linux でのみ行えます。',
        separatorModelNotFound: 'このモデルのファイルが配布元に見つかりません。',
        items: {
            python: 'Python 3.11 本体',
            pythonDesc:
                '音声機能 (音声分離・加工、音声変換、読み上げ) のプログラムを動かす実行環境です。パソコンに入っている Python とは別に、アプリ専用の場所で動きます。',
            separatorPackages: '音声分離のパッケージ一式',
            separatorPackagesDesc:
                '音声分離のプログラム (python-audio-separator) と、動作に必要なライブラリ (PyTorch など) の一式です。音声分離・加工と、音声変換の画面での分離に使います。macOS では Xcode Command Line Tools を、Linux では C/C++ のコンパイラー (build-essential など) を、先にインストールしておく必要があります。',
            converterPackages: '音声変換のパッケージ一式',
            converterPackagesDesc:
                '音声変換 (RVC) のプログラム (Applio) と、動作に必要なライブラリ (PyTorch など) の一式です。音声変換と、変換のモデルの学習に使います。',
            ttsPackages: '読み上げのパッケージ一式',
            ttsPackagesDesc:
                '読み上げのプログラム (Style-Bert-VITS2) と、動作に必要なライブラリ (PyTorch など) の一式です。読み上げに使います。',
            ttsTrainPackages: '読み上げの学習用パッケージ一式',
            ttsTrainPackagesDesc:
                '読み上げのモデルの学習に追加で必要なプログラムと、声の調子 (スタイル) を計算する話者埋め込みモデルの一式です。読み上げのモデルの学習に使います。NVIDIA GPU を使える Windows と Linux でのみ使えます。',
            rmvpe: 'ピッチ抽出モデル (RMVPE)',
            rmvpeDesc:
                '声の高さ (ピッチ) の動きを推定するモデルです。音声変換の変換と学習で、元の声の抑揚を保つために使います。',
            fcpe: 'ピッチ抽出モデル (FCPE)',
            fcpeDesc:
                '声の高さ (ピッチ) の動きを推定するモデルです。音声変換の変換で、ピッチ抽出に FCPE を選んだときに使います。RMVPE より軽く、速く動きます。',
            contentvec: '音声の特徴抽出モデル (ContentVec)',
            contentvecDesc:
                '声から、話している内容を表す特徴を取り出すモデルです。音声変換の変換と学習で使います。アプリでの学習は常にこのモデルを使い、配布されている声のモデルの多くもこのモデルで作られています。',
            rvcPretrained: '学習用の事前学習モデル (40kHz)',
            rvcPretrainedDesc:
                '大量の声で学習済みのモデルです。音声変換のモデルの学習をこの状態から始めるため、少ない録音でも短い時間で学習できます。',
            embedderSpin: '音声の特徴抽出モデル (SPIN)',
            embedderSpinDesc:
                '声から、話している内容を表す特徴を取り出すモデルです (ContentVec と同じ役割)。このモデルで作られた声のモデルで変換するときに使います。話者の違いに左右されにくい特徴を取り出すよう作られています。',
            embedderSpinV2: '音声の特徴抽出モデル (SPIN v2)',
            embedderSpinV2Desc:
                '声から、話している内容を表す特徴を取り出すモデルです (ContentVec と同じ役割)。このモデルで作られた声のモデルで変換するときに使います。SPIN の改良版です。',
            embedderJapaneseHubert: '音声の特徴抽出モデル (日本語 HuBERT)',
            embedderJapaneseHubertDesc:
                '声から、話している内容を表す特徴を取り出すモデルです (ContentVec と同じ役割)。このモデルで作られた声のモデルで変換するときに使います。日本語の音声で学習されています。',
            embedderChineseHubert: '音声の特徴抽出モデル (中国語 HuBERT)',
            embedderChineseHubertDesc:
                '声から、話している内容を表す特徴を取り出すモデルです (ContentVec と同じ役割)。このモデルで作られた声のモデルで変換するときに使います。中国語の音声で学習されています。',
            embedderKoreanHubert: '音声の特徴抽出モデル (韓国語 HuBERT)',
            embedderKoreanHubertDesc:
                '声から、話している内容を表す特徴を取り出すモデルです (ContentVec と同じ役割)。このモデルで作られた声のモデルで変換するときに使います。韓国語の音声で学習されています。',
            languageModelJa: '日本語の言語モデル (DeBERTa)',
            languageModelJaDesc:
                '日本語の文章の意味や文脈から、自然な抑揚を決めるモデルです。読み上げで日本語を読むときと、日本語の読み上げのモデルの学習に使います (JP-Extra 版・多言語版のどちらの声でも使います)。',
            languageModelEn: '英語の言語モデル (DeBERTa)',
            languageModelEnDesc:
                '英語の文章の意味や文脈から、自然な抑揚を決めるモデルです。読み上げで英語を読むときと、英語の読み上げのモデルの学習に使います。英語の発音を調べる辞書 (CMUdict) なども含みます。',
            languageModelZh: '中国語の言語モデル (RoBERTa)',
            languageModelZhDesc:
                '中国語の文章の意味や文脈から、自然な抑揚を決めるモデルです。読み上げで中国語を読むときと、中国語の読み上げのモデルの学習に使います。',
            ttsTrainJpExtra: '学習用の事前学習モデル (JP-Extra 版)',
            ttsTrainJpExtraDesc:
                'JP-Extra 版の読み上げのモデルの学習で、出発点にする学習済みのモデルです。学習中に音声の自然さを判定するモデル (WavLM) も含みます。',
            ttsTrainMultilingual: '学習用の事前学習モデル (多言語版)',
            ttsTrainMultilingualDesc: '多言語版の読み上げのモデルの学習で、出発点にする学習済みのモデルです。',
            jvnvFemaleJpExtraDesc:
                '女性の声 (JP-Extra 版) です。感情を込めて話した日本語の音声 (JVNV コーパス) から作られています。日本語を読めます。',
            jvnvMaleJpExtraDesc:
                '男性の声 (JP-Extra 版) です。感情を込めて話した日本語の音声 (JVNV コーパス) から作られています。日本語を読めます。',
            jvnvFemaleMultilingualDesc:
                '女性の声 (多言語版) です。感情を込めて話した日本語の音声 (JVNV コーパス) から作られています。日本語のほか英語・中国語も読めますが、話者が日本語話者のため、英語・中国語の発音は日本語なまりになります。',
            jvnvMaleMultilingualDesc:
                '男性の声 (多言語版) です。感情を込めて話した日本語の音声 (JVNV コーパス) から作られています。日本語のほか英語・中国語も読めますが、話者が日本語話者のため、英語・中国語の発音は日本語なまりになります。',
        },
    },
    update: {
        title: '音声機能の更新',
        message:
            'アプリの更新に伴い、次の項目を取得し直す必要があります (合計 {{size}})。今すぐダウンロードしますか？後で行う場合は、「ダウンロード管理」からいつでも更新できます。',
        later: '後で',
        run: 'ダウンロードして更新',
        done: '音声機能の更新が完了しました。',
        failed: '更新できなかった項目があります。「ダウンロード管理」から再試行してください。',
    },
    separation: {
        dropHint: 'ここに音声 (または動画) ファイルをドラッグ&ドロップ\nまたはクリックして選択',
        categories: {
            vocals: 'ボーカルと伴奏の 2 分割',
            multi: '楽器別の多分割',
            karaoke: 'メインボーカルとバックコーラスの分割',
            denoise: 'ノイズ除去',
            dereverb: '残響・エコーの除去',
            other: 'その他',
        },
        separateFrom: '分岐',
        separateFromFor: '{{name}}から分岐',
        dialogTitle: '分離: {{input}}',
        noResults: '音の「分岐」で、方式を選んで分離や加工をします。',
        recreate: 'パラメーターを変えて作成',
        recreateMessage:
            '作り直すと、この結果から分離した次の音が消えます (消えるのは、作り直しを実行した時点です)。よろしいですか？',
        removeMessage: '次の音が消えます。よろしいですか？',
        renameFor: '{{name}}の名前を変更',
        saveColumn: '対象',
        saveTargetFor: '{{name}}を保存対象にする',
        exportSummary: '書き出す音: {{count}} 個',
        exportNoTargets: '書き出す音の「対象」をチェックしてください。',
        method: '方式',
        methodSearch: '選ぶか、名前・説明・出力で絞り込む',
        noMatch: '該当するモデルがありません',
        methodHint: '2 つ以上選ぶと、各モデルの結果から 1 つの結果を決めます。',
        pickModes: {
            recommended: 'おすすめ',
            model: 'モデル',
            other: 'その他',
        },
        verifiedEnsemble: '配布元が検証した組み合わせ ({{count}} モデル)',
        categoryEmpty: 'このまとまりのモデルは取得していません。「ダウンロード管理」から取得できます。',
        selectedTitle: '選んだ内容',
        selectedNone: 'まだ選んでいません。',
        quality: '分離の品質: {{values}}',
        algorithm: '結果の決め方',
        algorithmNotes: {
            avg_wave: '各モデルの結果の波形を平均します。どれかの結果にしか無い音は薄まります (配布元の既定)。',
            median_wave:
                '各時点で、各モデルの結果の波形の真ん中の値を使います。3 つ以上のモデルで、1 つだけ外れた結果に引っ張られにくくなります。',
            min_wave:
                '各時点で、各モデルの結果の波形のうち大きさが最も小さい値を使います。混ざった音は減りますが、音が欠けやすくなります。',
            max_wave:
                '各時点で、各モデルの結果の波形のうち大きさが最も大きい値を使います。欠けにくくなりますが、混ざった音も残りやすくなります。',
            avg_fft: '周波数ごとに、各モデルの結果を平均します。どれかの結果にしか無い音は薄まります。',
            median_fft:
                '周波数ごとに、各モデルの結果の真ん中の値を使います。3 つ以上のモデルで、1 つだけ外れた結果に引っ張られにくくなります。',
            min_fft:
                '周波数ごとに、大きさが最も小さい値を使います。混ざった音は減りますが、音が欠けやすくなります (配布元の Vocal Clean が使う方法)。',
            max_fft:
                '周波数ごとに、大きさが最も大きい値を使います。欠けにくくなりますが、混ざった音も残りやすくなります (配布元の Vocal Full が使う方法)。',
            uvr_max_spec:
                'UVR (このライブラリの元になった分離ソフト) の方法で、周波数ごとに大きい方の値を使います。欠けにくくなりますが、混ざった音も残りやすくなります。',
            uvr_min_spec:
                'UVR (このライブラリの元になった分離ソフト) の方法で、周波数ごとに小さい方の値を使います。混ざった音は減りますが、音が欠けやすくなります。',
        },
        algorithms: {
            avg_wave: '平均 (波形)',
            median_wave: '中央値 (波形)',
            min_wave: '最小 (波形)',
            max_wave: '最大 (波形)',
            avg_fft: '平均 (スペクトル)',
            median_fft: '中央値 (スペクトル)',
            min_fft: '最小 (スペクトル)',
            max_fft: '最大 (スペクトル)',
            uvr_max_spec: '最大 (スペクトル・UVR 方式)',
            uvr_min_spec: '最小 (スペクトル・UVR 方式)',
        },
        advanced: '詳細な設定',
        paramsFor: 'パラメーター ({{arch}})',
        defaultParams: '既定の設定',
        params: {
            segmentSize: 'セグメントサイズ',
            overlap: 'オーバーラップ',
            overlapCount: 'オーバーラップ数',
            batchSize: 'バッチサイズ',
            hopLength: 'ホップ長',
            enableDenoise: 'デノイズ',
            windowSize: 'ウィンドウサイズ',
            aggression: '抽出の強さ',
            enableTta: 'TTA (精度を上げる・遅くなる)',
            enablePostProcess: '後処理',
            postProcessThreshold: '後処理のしきい値',
            highEndProcess: '高域処理',
            shifts: 'シフト数',
            segmentsEnabled: '区切って処理する',
            overrideModelSegmentSize: 'セグメントサイズを指定する',
            pitchShift: 'ピッチシフト (半音)',
            modelDefault: 'モデルの既定',
        },
        run: '分離を実行',
        running: '分離中',
        presetUnavailable:
            'このプリセットには、取得していないモデル (またはこの音源では使えない方式) が含まれています。その分は選ばれていません。',
        deleteResult: '結果を削除',
        rename: '名前を変更',
        trackName: '使う音の名前',
        trackNameHint: '空にすると「{{name}}」に戻ります。',
        invalidateTitle: '後で行った分離の結果が無効になります',
        invalidateRun: '破棄して変更',
    },
    tracks: {
        source: '元の音源',
    },
    export: {
        open: '書き出し...',
        title: '書き出し',
        format: '形式',
        outputDir: '書き出し先ディレクトリ',
        chooseFile: '保存先選択',
        resetPath: '個別の指定をやめる',
        run: '書き出す',
        running: '書き出し中',
        done: '{{count}} 個のファイルを書き出しました。',
        failed: '{{count}} 個のファイルを書き出せませんでした: {{error}}',
        overwriteTitle: '既存のファイルを上書きします',
        overwriteMessage:
            '書き出し先に同じ名前のファイルが {{count}} 件あります。上書きすると元に戻せません。書き出しますか？',
        overwriteRun: '上書きして書き出す',
        duplicate: '書き出し先のファイル名が重複しています。重ならないようにファイル名を変えてください。',
    },
    conversion: {
        steps: {
            input: '入力と分離',
            convert: '声質変換',
            mix: '合成',
        },
        modeSeparate: '楽曲 (伴奏を分離する)',
        modeDirect: '朗読などの音声 (伴奏なし)',
        modeHint:
            '楽曲はボーカルと伴奏に分けてからボーカルだけを変換し、伴奏と合成し直します。伴奏の無い音声は分離せずにそのまま変換します。',
        dropHint: 'ここに音声 (または動画) ファイルをドラッグ&ドロップ\nまたはクリックして選択',
        vocalsTrack: '変換する音',
        accompanimentTracks: '伴奏として重ねる音',
        voice: '声のモデル',
        noVoices: '声のモデルがありません。「声のモデル」で取り込むか、「モデルの学習」で作成してください。',
        pitch: 'キーの変更量 (半音)',
        pitchHint: 'オクターブ単位 (±12) 以外の場合は、伴奏も同じだけ移調します。',
        f0Method: 'ピッチ抽出方式',
        f0Methods: {
            rmvpe: 'RMVPE (推奨)',
            fcpe: 'FCPE',
            crepe: 'CREPE',
            'crepe-tiny': 'CREPE (軽量)',
        },
        indexRate: 'インデックスの効き具合',
        indexRateHint: '大きいほどモデルの声の特徴が強くなります。',
        noIndex: 'このモデルにはインデックスが無いため、この設定は効きません。',
        volumeEnvelope: '音量エンベロープの混合率',
        volumeEnvelopeHint: '小さいほど元の音声の抑揚 (音量の変化) に近づきます。',
        protect: '子音の保護',
        protectHint: '小さいほど子音や息の音を強く保護します。0.5 では保護しません。',
        run: '変換を実行',
        running: '変換中',
        candidates: '候補',
        noCandidates: '声のモデルとパラメーターを選んで変換を実行すると、結果が候補として並びます。',
        withAccompanimentCreate: '伴奏と重ねて聞く',
        withAccompanimentFor: '{{name}} を伴奏と重ねて聞く',
        withAccompanimentRendering: '伴奏と重ねています',
        paramsSummary:
            'キー {{pitch}} / {{f0}} / インデックス {{index}} / エンベロープ {{envelope}} / 保護 {{protect}}',
        targets: {
            converted: '変換後のボーカル',
            originalVocals: '変換前のボーカル',
            withAccompaniment: '伴奏と重ねた音',
            source: '元の音源',
            mix: '合成結果',
        },
        invalidateMessage:
            '入力 (ボーカルや伴奏) が変わったため、作成済みの変換と合成の結果は使えなくなります。破棄して進みますか？',
        exportMix: '合成結果',
        exportVocals: '変換後のボーカル',
        suffixConverted: '変換後',
        suffixConvertedVocals: '変換後ボーカル',
        suffixOriginalVocals: '変換前ボーカル',
        saveRow: '保存',
        saveRowFor: '{{name}}を保存',
    },
    filters: {
        muteSilence: '無音部分の雑音を消す',
        removeSilence: '無音部分を除去する',
        silenceThreshold: '無音とみなす大きさ (ピークから)',
        silenceLength: 'これより長い無音を対象にする',
        secondsValue: '{{value}} 秒',
        removeReverb: '残響・エコーを除去する (遅い)',
        dereverbModelMissing: '目的別のおすすめの「残響・エコーの除去」のモデルをダウンロードすると使えます。',
        dereverbModelSelect: '使うモデル',
        removeNoise: 'ノイズを除去する',
        noiseSimple: '簡易的に除去する (FFT・速い)',
        noiseWavelet: '簡易的に除去する (ウェーブレット・速い)',
        noiseModel: 'モデルで除去する (遅い)',
        noiseModelMissing: '目的別のおすすめの「ノイズ除去」のモデルをダウンロードすると使えます。',
        noiseFloor: '雑音とみなす大きさ',
        noiseReduction: '雑音を下げる量',
        waveletNoise: '雑音の大きさ',
        waveletPercent: '除去の強さ',
        noiseModelSelect: '使うモデル',
        loudness: '音量をそろえる',
        loudnessTarget: '目標の大きさ',
        summaryMuteSilence: '無音の雑音を消す {{db}} dB・{{seconds}} 秒',
        summaryNoiseSimple: 'ノイズ除去 (FFT) {{floor}} dB・{{reduction}} dB',
        summaryNoiseWavelet: 'ノイズ除去 (ウェーブレット) {{noise}} dB・{{percent}}%',
        summaryNoiseModel: 'ノイズ除去 ({{model}})',
        summaryDereverb: '残響・エコーの除去 ({{model}})',
        summaryRemoveSilence: '無音部分の除去 {{db}} dB・{{seconds}} 秒',
        summaryLoudness: '音量 {{lufs}} LUFS',
        filterTitle: 'フィルター: {{name}}',
        filterAllTitle: '学習セットのすべての音にフィルターを適用',
        filterAll: 'すべての音にフィルターを適用',
        filterFor: '{{name}}のフィルター',
        filterButton: 'フィルター',
        process: 'フィルター適用',
        preview: 'プレビュー',
        processResult: '適用結果 {{index}}',
        checking: '学習用の音を確かめています',
        checkFailed: '学習用の音を確かめられませんでした。学習は始めます。({{error}})',
        processing: 'フィルターを適用しています',
        original: '元の音',
        confirm: '確定',
        applyAll: '適用',
        applyingAll: 'フィルターを適用しています',
        replaced: '選んだ音で置き換えました。',
        appliedAll: 'すべての音にフィルターを適用しました。',
        silenceCheckTitle: '長い無音を含む音があります',
        silenceCheckMessage:
            '次の音に、長い無音が含まれています。無音は読み上げの間として覚えられます。フィルターの「無音部分を除去する」で取り除けます。',
        silenceCheckItem: '{{name}}: 無音 {{seconds}} 秒',
        continueAnyway: '了解して続行',
    },
    mix: {
        vocalGain: 'ボーカルの音量',
        vocalGainHint: '0 dB で変換前のボーカルと同じ大きさになります。',
        accompanimentGain: '伴奏の音量',
        reverb: 'リバーブ (ボーカル)',
        roomSize: '部屋の大きさ',
        damping: '高域の減衰',
        wetLevel: '残響音の量',
        dryLevel: '原音の量 (1 で元の大きさ)',
        width: 'ステレオの広がり',
        masterGain: '全体の音量',
        preview: '合成を作成',
        rendering: '合成中',
        stale: '設定または選んだ候補が変わっています。「合成を作成」を押すと作り直します。',
        builtin: {
            standard: '軽いリバーブ',
            dry: 'リバーブなし',
            hall: 'ホール',
            vocalForward: 'ボーカルを前に',
        },
    },
    presets: {
        label: 'プリセット',
        none: 'プリセットはありません',
        overwrite: '選択中のプリセットに上書き保存',
        overwriteConfirm: 'プリセット「{{name}}」を現在の値で上書きしますか？',
        overwriteRun: '上書き保存',
        saveNew: '新しいプリセットとして保存',
        rename: '名前を変更',
        delete: 'プリセットを削除',
        deleteConfirm: 'プリセット「{{name}}」を削除しますか？',
        locked: '{{action}} (アプリに用意されたプリセットは変更できません)',
        name: 'プリセット名',
        saved: 'プリセットを保存しました。',
    },
    models: {
        import: '取り込み',
        searchHub: 'Hugging Face で探す',
        getReadyModels: 'すぐに使えるモデルを取得',
        intro: {
            converter:
                '音声変換 (RVC) の声のモデルです。アイコンの付いたモデルは、このアプリで学習して作成したものです。',
            tts: '読み上げ (Style-Bert-VITS2) の声のモデルです。アイコンの付いたモデルは、このアプリで学習して作成したものです。',
        },
        empty: '声のモデルがありません。',
        name: '名前',
        details: '情報',
        actions: '操作',
        userModel: 'このアプリで学習して作成したモデル',
        rvcInfo: 'RVC {{version}} / {{rate}} Hz / インデックス{{index}} / {{embedder}}',
        indexYes: 'あり',
        indexNo: 'なし',
        ttsInfo: '{{modelType}} / スタイル {{styles}} 種 / 形式 {{version}}',
        languages: '対応する言語',
        languagesHint: '多言語版のモデルを使う言語を選んでください。選んだ言語の文章にだけ使えるようになります。',
        rename: '名前を変更',
        editLanguages: '対応する言語を変更',
        duplicateName: '同じ名前のモデルがすでにあります。\n選ぶときに区別できるよう、別の名前をおすすめします。',
        export: '書き出し',
        exporting: '書き出し中',
        exported: 'モデルを書き出しました。',
        imported: '「{{name}}」を取り込みました。',
        delete: '削除',
        deleteConfirm: '「{{name}}」を削除しますか？',
        deleteUserData:
            'このモデルは学習または取り込みで作成したもので、ダウンロードし直すことはできません。削除するとゴミ箱へ移動します (ゴミ箱を使えない場合は完全に削除します)。',
        deleteReady: 'すぐに使えるモデルは「ダウンロード管理」から再度取得できます。',
    },
    import: {
        title: '声のモデルの取り込み',
        noticeTitle: '取り込む前に確認してください',
        notice: {
            license:
                'モデルは、配布元の利用規約やライセンス (クレジット表示・商用利用・再配布・用途の制限など) に従って利用してください。',
            consent: '声の持ち主やキャラクターの権利者の許諾なく作られたモデルは使わないでください。',
            misuse: 'なりすましやディープフェイクの作成など、他者を欺いたり権利を侵害したりする目的には使わないでください。',
            responsibility: 'モデルの利用とその結果の責任は利用者にあります。',
            converter:
                '公開されている RVC モデルには、公式に配布されているものや有料・無料で配布されているものがある一方、許諾なく作られたものもあります。配布条件はモデルごとに異なります。',
            tts: 'Style-Bert-VITS2 の開発陣も、なりすまし・ディープフェイク作成などの目的で使わないこと、使用するモデルの規約・ライセンスを確認して従うことを求めています。',
        },
        agree: '上記を確認し、同意します',
        next: '同意してファイルを選択',
        selectHint: {
            converter:
                'このアプリで書き出したファイル (.zip)、または RVC のモデル (.pth、検索用インデックス .index は任意) を選んでください。zip のままでも取り込めます。',
            tts: 'このアプリで書き出したファイル (.zip)、または Style-Bert-VITS2 のモデル (*.safetensors) を選んでください。同じフォルダの config.json と style_vectors.npy も一緒に取り込みます。モデルの入ったフォルダや zip も選べます。',
        },
        chooseFiles: 'ファイル選択',
        chooseFolder: 'フォルダ選択',
        inspecting: 'ファイルを確認しています…',
        multipleCandidates: '取り込めるファイルが複数見つかりました。取り込むものを選んでください。',
        modelFile: 'モデルのファイル',
        indexFile: 'インデックスのファイル',
        sourceKura:
            'このアプリで書き出したモデルです。書き出す前の名前で取り込み、このアプリで学習したモデルの印も戻します。',
        sourceExternal: '外部で入手したモデルです。',
        unsafeTitle: '安全な方式で読み込めませんでした',
        unsafeMessage: {
            converter:
                'このファイルには、重み (数値) 以外のデータが含まれています。pth 形式は読み込み時にファイル内のプログラムが実行され得る形式で、悪意のあるモデルが公開されていた例もあります。制限なしで読み込むと、ファイルに含まれるプログラムが実行される危険があります。読み込んだ後は重みと設定値だけを安全な形式で保存し、以降は危険な読み込みを行いません。',
            tts: 'style_vectors.npy に数値の配列以外のデータが含まれています。制限なしで読み込むと、ファイルに含まれるプログラムが実行される危険があります。読み込んだ後は数値の配列だけを安全な形式で保存し直します。',
        },
        allowUnsafe: '危険性を理解したうえで、制限なしで読み込む (結果は自己責任)',
        run: '取り込む',
    },
    tts: {
        newText: '新規',
        open: '開く',
        save: '保存',
        saveAs: '名前を付けて保存',
        saved: '保存しました。',
        inputMode: '入力方法',
        inputModes: {
            normal: '通常',
            timed: 'タイミング指定',
        },
        placeholder:
            'ここに読み上げる文章を入力します。改行ごとに区切って読み上げます。\n制御タグ (例: <break time="500ms"/>) で間や話速などを指定できます。',
        timed: {
            start: '開始',
            end: '終了',
            text: 'テキスト',
            textPlaceholder: '読み上げるテキスト',
            textOf: '{{row}} 行目のテキスト',
            addRow: '行を追加',
            insertBelow: '下に行を挿入',
            removeRow: '行を削除',
            empty: '「行を追加」で入力するか、「開く」で字幕ファイルを読み込んでください。',
            addRowFirst: '先に行を追加してください。',
            rowIssue: '{{row}} 行目: {{message}}',
            errorAt: '表の {{row}} 行目、テキストの {{line}} 行 {{column}} 文字目: {{message}}',
            fixItem: '{{row}} 行目 {{line}}:{{column}} {{kind}}「{{from}}」→「{{to}}」',
            issues: {
                startFormat: '開始時間の形式が正しくありません (例: 00:01:02.500)。',
                endFormat: '終了時間の形式が正しくありません (例: 00:01:05.000)。',
                endBeforeStart: '終了時間は開始時間より後にしてください。',
                startAfterLater: '開始時間が、後の行の開始時間より後になっています。',
                emptyText: 'テキストを入力してください。',
            },
            unsupportedFile: 'このファイルの形式には対応していません。',
            noLines: 'ファイルから読み上げる内容を読み取れませんでした。',
            skipped:
                '時間を読み取れない {{count}} か所は読み込みませんでした。元のファイルを上書きしないよう、保存するときは保存先を選んでください。',
            saveInvalidTime: '{{row}} 行目の時間の形式が正しくないため、保存できません。',
        },
        language: '言語',
        modelType: 'モデルの種類',
        languageModelMissing: '{{language}}の言語モデルがダウンロードされていません。',
        voice: '声のモデル',
        noVoices:
            'このモデルの種類と言語で使える声のモデルがありません。「声のモデル」ですぐに使えるモデルを取得するか、モデルを取り込んでください。',
        style: 'スタイル',
        speaker: '話者',
        styleWeight: 'スタイルの強さ',
        speed: '話速',
        pitchScale: '音の高さ',
        intonationScale: '抑揚',
        advanced: '詳細な設定',
        sdpRatio: 'テンポのばらつき',
        noise: '感情表現のばらつき',
        noiseW: '音の長さのばらつき',
        paragraphPause: '行と行の間の無音',
        readSymbols: '記号を読み上げる',
        overflowMode: '時間内に収まらない場合',
        overflowHint: '行ごとに変える場合は、その行に fit タグを書きます。',
        overflow: {
            speedup: '話速を上げて収める',
            overlap: '次の行と重ねる',
            shift: '後続の行を後ろにずらす',
            warn: '警告のみ',
        },
        cueTime: '時間',
        cueText: 'テキスト',
        run: '音声を作成',
        running: '音声を作成中',
        empty: '読み上げる文章を入力してください。',
        hasErrors: '誤りがあるため、音声を作成できません。示した箇所を修正してください。',
        errorAt: '{{line}} 行 {{column}} 文字目: {{message}}',
        fixesPending:
            '制御タグに、大文字小文字の違いや向き付き引用符が {{count}} 箇所あります。音声を作成するときに、まとめて直してよいかを確認します。',
        fixTitle: '制御タグを修正します',
        fixMessage:
            '次の箇所を修正してから読み上げます (タグ名・属性名を小文字に、向き付き引用符を「"」に置き換えます)。よろしいですか？',
        fixItem: '{{line}}:{{column}} {{kind}}「{{from}}」→「{{to}}」',
        fixKinds: {
            tagNameCase: 'タグ名',
            attributeNameCase: '属性名',
            curlyQuote: '引用符',
        },
        fixAccept: '修正して作成',
        fixReject: '修正せずに中止',
        speedupTitle: '話速を大きく上げる行があります',
        speedupMessage:
            '次の行は、時間内に収めるには話速を 1.3 倍より大きく上げる必要があります。話速を上げて作成しますか？',
        factor: '必要な倍率',
        speedupAccept: '話速を上げて作成',
        speedupReject: '中止',
        reportTitle: '読み上げの結果',
        reportAdjusted: '話速を調整した行:',
        reportAdjustedItem: '{{index}} 行目: {{factor}} 倍',
        reportOverflows: '時間内に収まらなかった行:',
        reportOverflowItem: '{{index}} 行目: {{seconds}} 秒はみ出しています',
        exportLabel: '読み上げ結果',
        discardChanges: '編集中の文章は保存されていません。破棄して新しい文章を始めますか？',
        discardForOpen: '編集中の文章は保存されていません。破棄してファイルを開きますか？',
        secondsValue: '{{value}} 秒',
    },
    tags: {
        groups: {
            ssml: 'SSML',
            custom: '独自形式',
        },
        open: '制御タグ',
        title: '制御タグの一覧',
        intro: '半角の「<」「>」で書いた次のタグを、読み上げの制御として解釈します。例を選ぶとカーソルの位置に挿入し、文章を選択している場合はその範囲を囲みます。',
        insert: '挿入',
        wrap: '囲む',
        saveToFile: 'ファイルに保存',
        saved: 'ファイルに保存しました。',
        fileIntro: '半角の「<」「>」で書いた次のタグを、読み上げの制御として解釈します。',
        break: {
            description: '間 (無音) を挿入します。単独で完結するタグで、終端の「/」は省略できます。',
            time: '長さ。「500ms」「1.5s」など',
            strength: '強さ。none / x-weak / weak / medium / strong / x-strong',
        },
        prosody: {
            description:
                '囲んだ範囲の話速・音の高さ・音量を変えます。入れ子にすると話速は掛け合わせ、音の高さと音量は足し合わせます。',
            rate: '話速。「120%」(既定の話速に対する割合)、「+20%」「-20%」、または x-slow / slow / medium / fast / x-fast',
            pitch: '音の高さ。「+2st」「-3st」(半音)、「+10%」「-10%」、または x-low / low / medium / high / x-high',
            volume: '音量。「+6dB」「-3dB」、または silent / x-soft / soft / medium / loud / x-loud',
        },
        sub: {
            description: '囲んだ文字を、別の読みに置き換えて読み上げます (略語や記号の読みなど)。',
            alias: '読み上げる文字列 (必須)',
        },
        phoneme: {
            descriptionJa:
                "囲んだ語の読みとアクセントを指定します (日本語のアクセント記法)。\nph にカタカナの読みを書き、音が下がる直前の拍の直後に「'」を置きます。「'」が無い場合は平板型です。複数のアクセント句にまたがる場合は「/」で区切ります。\n高低は東京式アクセントの規則で決まります (核が 1 拍目なら 1 拍目だけ高く、それ以外は 1 拍目が低く 2 拍目から核まで高い。平板型は 2 拍目以降が高い)。",
            descriptionEn:
                '囲んだ語の発音を IPA (国際音声記号) で指定します。語ごとに空白で区切り、「ˈ」「ˌ」で強勢を示します。日本語のアクセント記法は英語の文章では使えません。',
            descriptionZh:
                '囲んだ漢字の発音をピンインで指定します。多音字の読み分けなどに使います。1 文字に 1 音節を対応させるため、囲む文字は漢字だけにしてください。声調は指定どおりになり、自動の声調変化 (変調) は行いません。',
            phJa: "カタカナの読み + アクセント記号。例: ハ'シ (箸) / ハシ' (橋) / ハシ (端)",
            phEn: 'IPA の発音。例: təˈmɑːtoʊ',
            phZh: '文字ごとのピンイン + 声調の数字 (1〜4、軽声は 5) を空白で区切ります。ü は v と書きます。例: yin2 hang2 (银行)',
            alphabet: '省略可能。日本語は x-kana (アクセント記法)、英語は ipa、中国語は x-pinyin (ピンイン)',
        },
        fit: {
            description:
                'タイミング指定の行で、時間内に収まらない場合の扱いを、その行だけ全体の設定から変えます。行のどこに書いてもかまいません。',
            mode: '扱い。speedup (話速を上げて収める) / overlap (次の行と重ねる) / shift (後続の行を後ろにずらす) / warn (警告のみ)',
        },
        escapeTitle: 'タグと同じ文字列を本文に書く場合',
        escape: '「<break」のように既知のタグ名で始まる文字列を本文として書きたい場合は、「&lt;」(<)・「&gt;」(>)・「&amp;」(&) などの置き換え表記を使ってください。\nそれ以外の「<～>」と全角の「＜」「＞」は本文として扱い、記号の読み上げ設定に従います。\nタイミング指定の行では、字幕の装飾の印 (<i>・<b>・<u>・<s>・<font>) は文章に残したまま読み上げません。',
    },
    tagErrors: {
        unclosedQuote: '「{{tag}}」タグの属性値の引用符が閉じられていません。',
        unclosedTag: '「{{tag}}」タグが「>」で閉じられていません。',
        unexpectedChar: '「{{tag}}」タグの中に書けない文字「{{value}}」があります。',
        missingEquals: '「{{tag}}」タグの属性「{{attribute}}」に「=」と値がありません。',
        unquotedValue: '「{{tag}}」タグの属性「{{attribute}}」の値を引用符 (") で囲んでください。',
        unknownAttribute: '「{{tag}}」タグに属性「{{attribute}}」はありません。',
        duplicateAttribute: '「{{tag}}」タグで属性「{{attribute}}」が重複しています。',
        missingAttribute: '「{{tag}}」タグに必須の属性「{{attribute}}」がありません。',
        invalidValue: '「{{tag}}」タグの属性「{{attribute}}」の値「{{value}}」が正しくありません ({{format}})。',
        attributeOnClosingTag: '閉じタグ「{{tag}}」に属性は書けません。',
        missingClosingTag: '「{{tag}}」タグの閉じタグがありません。',
        nothingToRead: '読み上げる文字がありません。',
        paragraphTooLong: 'この段落は長すぎて作成できません。途中に改行を入れて分けてください。',
        rowTooLong: 'この行は長すぎて作成できません。行を分けてください。',
        unmatchedClosingTag: '閉じタグ「{{tag}}」に対応する開始タグがありません。',
        misnested: 'タグの入れ子が正しくありません。「{{tag}}」より先に「{{expected}}」を閉じてください。',
        emptyContent: '「{{tag}}」タグで囲む文字がありません。',
        nestedTagNotAllowed: '「{{tag}}」タグの中にタグ「{{value}}」は書けません。',
        accentNotJapanese: '日本語のアクセント記法は日本語の文章でのみ使えます。',
        ipaNotEnglish: 'IPA による発音の指定は英語の文章でのみ使えます。',
        pinyinNotChinese: 'ピンインによる発音の指定は中国語の文章でのみ使えます。',
        pinyinSyllable:
            '扱えないピンイン「{{value}}」があります。音節と声調の数字 (1〜5) を続けて書いてください (例: zhong1)。',
        pinyinSurface: 'ピンインで発音を指定する文字は漢字だけにしてください。',
        pinyinCount: 'ピンインの音節の数 ({{value}}) が漢字の数 ({{expected}}) と一致しません。',
        accentSyntax: 'アクセント記法の誤り「{{value}}」: {{accent}}',
        ipaSymbol: '扱えない発音記号「{{value}}」があります。',
        ipaWordCount: '発音の語数 ({{value}}) が、囲んだ文字の語数 ({{expected}}) と一致しません。',
        fitNotTimed: '「fit」タグはタイミング指定の行でだけ使えます。',
        duplicateFit: '1 つの行に「fit」タグが複数あります。',
        formats: {
            time: '「500ms」「1.5s」など',
            strength: 'none / x-weak / weak / medium / strong / x-strong',
            rate: '「120%」「+20%」またはラベル (0% より大きい値)',
            pitch: '「+2st」「+10%」またはラベル',
            volume: '「+6dB」「-3dB」またはラベル',
            alphabet: 'x-kana・ipa・x-pinyin のいずれか',
            nonEmpty: '空にできません',
            fitMode: 'speedup・overlap・shift・warn のいずれか',
        },
        accent: {
            empty: '読みが空です',
            emptyPhrase: '「/」で区切った句が空です',
            invalidChar: "カタカナ・「'」・「/」以外の文字は使えません",
            unknownMora: '使えない拍 (カナの組み合わせ) です',
            markAtStart: "「'」は拍の後ろに置いてください",
            multipleMarks: "1 つの句に「'」は 1 つまでです",
            longVowelAtStart: '「ー」の前に拍がありません',
            longVowelAfterSokuon: '「ッ」の後ろに「ー」は置けません',
        },
    },
    symbols: {
        title: '記号の読み ({{language}})',
        edit: '記号の読みを編集',
        hint: '「記号を読み上げる」をオンにしたときに使う読みです。全角と半角は別の記号として扱います。句読点 ({{punctuation}}) は常に読み上げの区切りとして扱うため、ここには登録できません。文脈によって読みが変わる記号は代表的な読みを 1 つ登録し、個別の箇所は sub タグで指定してください。',
        symbol: '記号',
        reading: '読み',
        add: '追加',
        delete: 'この記号を削除',
        resetDefaults: '初期値に戻す',
        resetConfirm: '一覧を初期値に戻します。追加・変更した読みは一覧から消えます。よろしいですか？',
        invalid: '空の項目・重複・句読点があります。',
    },
    recorder: {
        start: '録音',
        stop: '録音を停止',
        clipping: '音が大きすぎます',
        cancel: '録音をキャンセル',
        denied: 'マイクを使えません。システム設定でこのアプリにマイクの使用を許可してください。',
        error: 'マイクを開始できませんでした: {{detail}}',
    },
    trainingSets: {
        label: '学習セット',
        none: '学習セットがありません',
        empty: '学習用の音声は、名前を付けた学習セットに保存します。まず学習セットを作成してください。',
        ttsDetail: '{{language}} / サンプル文 / 音声のある文 {{count}} 文 / {{duration}}',
        ttsCustomDetail: '{{language}} / 任意の文 / 音声 {{count}} 件 / {{duration}}',
        rvcDetail: '{{count}} 件 / {{duration}}',
        create: '新しい学習セット',
        createAction: '作成',
        rename: '名前を変更',
        renameAction: '変更',
        remove: '学習セットを削除',
        removeAction: '削除',
        removeConfirm: '学習セット「{{name}}」を削除します。学習セットはごみ箱に移ります。よろしいですか？',
        removed: '学習セット「{{name}}」をごみ箱に移しました。',
        name: '名前',
        mode: 'モード',
        modes: {
            sentences: 'サンプル文から作成',
            custom: '任意の文で作成',
        },
        languageFixed: '言語とモードは作成した後に変更できません。',
    },
    training: {
        running: 'モデルを学習中',
        adding: '音声を追加中',
        rvcGuide:
            '学習用の音声は、変換したい音声に近い環境 (マイク・部屋・話し方や歌い方) で録音したものを使うと、よいモデルになります。歌声・話し声のどちらでも構いません。',
        addFiles: '音声ファイルを追加',
        deleteAudioTitle: '音声の削除',
        deleteAudioConfirm: '「{{name}}」を学習セットから削除します。削除した音声は元に戻せません。よろしいですか？',
        deleteSentenceAudioConfirm:
            'この文の音声を学習セットから削除します。削除した音声は元に戻せません。よろしいですか？',
        deleteAudio: '音声を削除',
        datasetNote:
            '録音した音声と選択した音声ファイルは、学習セットの中に保存します (元のファイルは、追加した後に移動・削除して構いません)。学習セットは学習が終わっても残ります。',
        datasetSummary: '{{count}} 件 / 合計 {{duration}}',
        datasetEmpty: '録音するか、音声ファイルを追加してください。',
        duplicateSkipped: '同じ名前のファイルがすでに追加されているため、次のファイルは追加しませんでした: {{names}}',
        dropUnsupported: 'この形式のファイルは追加できません。',
        recordingName: '録音 {{date}}',
        rvcShort: '音声が 10 分より短いと、声の特徴を十分に学習できないことがあります。',
        modelName: 'モデルの名前',
        epochs: '学習回数',
        epochsFromSteps: 'ステップ数から計算',
        epochsFromStepsTitle: 'ステップ数から学習回数を計算',
        steps: 'ステップ数',
        epochsResult: '学習回数: {{epochs}} 回',
        epochsConfirm: '確定',
        start: '学習を開始',
        rvcNote: 'GPU の性能と音声の量によっては数時間かかります。',
        doneTitle: '学習が完了しました',
        doneMessage: '声のモデル「{{name}}」を作成しました。',
        openModels: '「声のモデル」を開く',
        ttsUnavailableTitle: 'この環境では読み上げのモデルを学習できません',
        ttsUnavailable:
            '読み上げのモデルの学習は、NVIDIA GPU を使える Windows と Linux でのみ行えます。そのような環境で学習したモデルを書き出し、ここで取り込めば利用できます。',
        ttsGuide:
            '左の一覧から文を選び、その文を読み上げて録音するか、その 1 文を読み上げた音声ファイルを選択してください。どの文から録っても構わず、読みたくない文は飛ばして構いません。提示した文章は、その音声の書き起こしとしてそのまま使います。複数の文を続けて録ったファイルは、1 文ずつに分けてから選択してください。',
        ttsCustomGuide:
            'グループを追加し、グループごとに、録音するか音声ファイルを選択して音声を用意し、その音声で読み上げている本文を入力 (またはテキストファイルを選択) してください。本文は、その音声の書き起こしとしてそのまま使います。音声と本文の両方があるグループを学習に使います。',
        sentenceIndex: '{{index}} / {{total}} 文目 ({{id}})',
        recorded: '音声あり',
        notRecorded: '音声なし',
        rerecord: '録音し直す',
        chooseSentenceFile: '音声ファイル選択',
        removeSentenceAudio: 'この文の音声を削除',
        previous: '前の文',
        next: '次の文',
        progressSummary: '音声あり {{recorded}} / {{total}} 文 (合計 {{duration}})',
        addGroup: 'グループを追加',
        groupsEmpty: '「グループを追加」で、音声と本文の組を追加してください。',
        groupTitle: 'グループ {{index}}',
        chooseAudioFile: '音声ファイル選択',
        groupText: '本文',
        chooseTextFile: 'テキストファイル選択',
        removeGroup: 'グループを削除',
        removeGroupFor: 'グループ {{index}} を削除',
        removeGroupAction: '削除',
        removeGroupConfirm:
            'グループ {{index}} を削除します。このグループの音声と本文は元に戻せません。よろしいですか？',
        groupSummary: '音声と本文のあるグループ {{ready}} / {{total}} (合計 {{duration}})',
        sentenceCounts:
            '学習に必要な音声のある文の数: 最低 {{minimum}} 文、推奨 {{recommended}} 文以上。文の数が多いほど、声や話し方を再現しやすくなります。',
    },
    // ファイルを選ぶダイアログの種類の名前
    fileFilters: {
        audio: '音声・動画ファイル',
        allFiles: 'すべてのファイル',
        rvcModel: 'RVC のモデル',
        ttsModel: 'Style-Bert-VITS2 のモデル',
        voiceModel: '声のモデル',
        text: '文章',
        srt: 'SRT 字幕',
        markdown: 'Markdown',
        subtitles: '字幕 (SRT・WebVTT・ASS・SSA・SBV)',
    },
    errors: {
        KURA_CANCELLED: 'キャンセルされました。',
        SAMPLE_RATE_MISMATCH: '合成した音声のサンプリング周波数がそろっていません。({{detail}})',
        LIBRARY_BUSY: '処理中のものがあるため、今は実行できません。処理が終わってから、もう一度お試しください。',
        PLATFORM_UNSUPPORTED: 'この環境では音声機能を利用できません。',
        VC_RUNTIME_MISSING:
            'Microsoft Visual C++ 再頒布可能パッケージが必要です。インストールしてから再試行してください。',
        PYTHON_MISSING: 'Python 本体がダウンロードされていません。',
        PYTHON_BROKEN: 'Python 本体を起動できませんでした。「ダウンロード管理」から取得し直してください。({{detail}})',
        VENV_FAILED: 'パッケージ一式の準備に失敗しました。({{detail}})',
        PIP_FAILED: 'パッケージのインストールに失敗しました。通信状況を確認して再試行してください。({{detail}})',
        BUILD_TOOLS_MISSING:
            'パッケージの組み立てに必要な開発ツールが見つかりません。Windows では Microsoft C++ Build Tools を、macOS では「xcode-select --install」で Command Line Tools を、Linux では C/C++ のコンパイラー (build-essential など) をインストールしてから再試行してください。',
        VERIFY_FAILED: 'パッケージ一式を正しくインストールできませんでした。再試行してください。({{detail}})',
        DOWNLOAD_FAILED: 'ダウンロードに失敗しました。通信状況を確認して再試行してください。({{detail}})',
        PREREQUISITE_FAILED: '前提となる項目を取得できなかったため、取得しませんでした。',
        SEPARATOR_NOT_INSTALLED:
            '音声分離のパッケージ一式がダウンロードされていないか、更新が必要です。「ダウンロード管理」から取得してください。',
        MODEL_NOT_INSTALLED: '必要なモデルがダウンロードされていません。',
        SEPARATOR_MODEL_NOT_FOUND: '分離モデルのファイルが配布元に見つかりません。({{detail}})',
        ENSEMBLE_NOT_FOUND: '選んだ検証済みの組み合わせが、分離モデルの一覧にありません。({{detail}})',
        MODEL_REQUIRED: '必要なモデルがダウンロードされていません。「ダウンロード管理」から取得してください。',
        MODEL_FILE_MISSING:
            'モデルのファイルが見つかりません ({{detail}})。「ダウンロード管理」から取得し直してください。',
        SEPARATION_NO_OUTPUT: '分離の結果が出力されませんでした。',
        NO_AUDIO_STREAM: 'このファイルには音声が含まれていません。',
        RUBBERBAND_UNAVAILABLE:
            '設定中の ffmpeg には rubberband フィルタ (伴奏の移調・話速の微調整に使用) が含まれていません。rubberband を含む ffmpeg (Windows では winget の Gyan.FFmpeg、macOS では Homebrew の ffmpeg、Linux ではディストリビューションの ffmpeg など) を用意し、アプリ設定で ffmpeg を見直してください。',
        EMBEDDER_MISSING:
            'このモデルが使う話者特徴の抽出モデル ({{detail}}) がダウンロードされていません。「ダウンロード管理」から取得してください。',
        EMBEDDER_UNSUPPORTED: 'このモデルが使う話者特徴の抽出方式 ({{detail}}) には対応していません。',
        CONVERSION_FAILED: '変換に失敗しました。',
        INVALID_RVC_MODEL: 'RVC のモデルとして読み込めませんでした。({{detail}})',
        RVC_VERSION_UNSUPPORTED: '対応していない RVC のバージョンです ({{detail}})。',
        RVC_VOCODER_UNSUPPORTED: '対応していないボコーダーです ({{detail}})。',
        UNSAFE_MODEL: '安全な方式で読み込めないモデルです。',
        IMPORT_INVALID_FILE: 'このアプリで書き出したモデルのファイルではありません。',
        IMPORT_WRONG_FEATURE: '別の機能 (音声変換 / 読み上げ) のモデルです。',
        IMPORT_FILES_MISSING: 'モデルを構成するファイルが足りません ({{detail}})。',
        IMPORT_PTH_NOT_FOUND: 'RVC のモデル (.pth) が見つかりません。',
        IMPORT_NO_FILES: 'ファイルが選ばれていません。',
        IMPORT_EXPIRED: '取り込みの確認が中断されました。最初からやり直してください。',
        IMPORT_UNSAFE_NOT_ALLOWED: '制限なしの読み込みが許可されていません。',
        INVALID_SAFETENSORS: 'モデル本体 (safetensors) を読み込めませんでした。',
        TTS_NOT_INSTALLED: '読み上げのパッケージ一式がダウンロードされていません。',
        TTS_MODEL_TYPE_MISMATCH: '選んだモデルの種類と、声のモデルの種類が一致しません。',
        TTS_PARAMS_INVALID: '読み上げの設定値が範囲外です。設定を確認してください。',
        TTS_LANGUAGE_UNSUPPORTED: 'この声のモデルは選んだ言語に対応していません。',
        VOICE_NOT_FOUND: '声のモデルが見つかりません。',
        VOICE_NAME_EMPTY: '名前を入力してください。',
        VOICE_LANGUAGES_EMPTY: '言語を 1 つ以上選んでください。',
        VOICE_LANGUAGES_FIXED: 'JP-Extra 版のモデルは日本語専用です。',
        INVALID_TTS_MODEL: '読み上げのモデルとして読み込めませんでした。({{detail}})',
        NLTK_DATA_MISSING:
            '英語の読み上げに必要なデータがありません。「英語の言語モデル (DeBERTa)」を取得し直してください。',
        PINYIN_ALIGN_FAILED: 'ピンインで発音を指定した文字の位置を合わせられませんでした。指定を見直してください。',
        IPA_WORD_SPLIT: '「{{detail}}」には発音を指定できません。sub タグで読みを指定してください。',
        TTS_TRAINING_UNAVAILABLE: '読み上げのモデルの学習は、NVIDIA GPU を使える Windows と Linux でのみ行えます。',
        TTS_MODEL_TYPE_LANGUAGE_MISMATCH: 'この言語は、この種類のモデルでは学習できません。',
        TTS_CONFIRMATION_EXPIRED: 'この確認は無効になりました。もう一度音声を作成してください。',
        TRAINING_DATA_TOO_SHORT: '学習用の音声が短すぎます。',
        TRAINING_DATA_TOO_FEW: '音声のある文が少なすぎます。',
        TRAINING_FILE_UNREADABLE: 'この学習用の音声ファイルを読み込めませんでした。({{detail}})',
        TRAINING_FILE_MISSING:
            '学習セットの音声ファイルが見つかりません。その音声を削除してから、録音し直すか選択し直してください。({{detail}})',
        TRAINING_SET_NOT_FOUND: '学習セットが見つかりません。',
        TRAINING_SET_IN_USE: 'この学習セットは学習に使っている間は変更・削除できません。',
        DEREVERB_MODEL_REQUIRED:
            '残響・エコーの除去のモデルがありません。目的別のおすすめの「残響・エコーの除去」のモデルをダウンロードしてください。',
        NOISE_REMOVAL_MODEL_REQUIRED:
            'ノイズ除去のモデルがありません。目的別のおすすめの「ノイズ除去」のモデルをダウンロードしてください。',
        NOTHING_TO_PROCESS: '加工の内容を 1 つ以上チェックしてください。',
        STEM_NOT_FOUND: 'モデルの出力に、使う出力が見つかりませんでした。',
        TRAINING_AUDIO_NOT_FOUND: '学習セットに、その音がありません。',
        TRAINING_SET_NAME_EMPTY: '学習セットの名前を入力してください。',
        TRAINING_SET_LANGUAGE_MISMATCH: '学習セットの言語の指定が正しくありません。',
        TRAINING_SET_MODE_MISMATCH: '学習セットのモードの指定が正しくありません。',
        INVALID_EPOCHS: '学習回数の指定が正しくありません。',
        INVALID_TEXT: '本文の指定が正しくありません。',
        TRAINING_GROUPS_EMPTY: '音声と本文の両方があるグループがありません。',
        TRAINING_GROUP_TEXT_INVALID:
            '次のグループの本文を読みに変換できませんでした: グループ {{detail}}。読み方の分からない語や記号、長すぎる文が含まれていないか確認してください。',
        TRAINING_TEXT_INVALID: '次の文を読みに変換できませんでした。({{detail}})',
        INVALID_TRAINING_SET_ID: '学習セットの指定が正しくありません。',
        SEPARATOR_LIST_OUTDATED:
            '分離のパッケージ一式が変わったため、分離モデルの一覧を作り直す必要があります。もう一度お試しください。',
        UNKNOWN_SENTENCE: '読み上げ文の指定が正しくありません。',
        INVALID_FEATURE: '機能の指定が正しくありません。({{detail}})',
        INVALID_LANGUAGE: '言語の指定が正しくありません。({{detail}})',
        TRAINING_FAILED: '学習に失敗しました。({{detail}})',
        TRAINING_STEP_FAILED: '学習の途中で失敗しました。({{detail}})',
        TRAINING_NO_AUDIO: '学習に使える音声がありませんでした (無音や短すぎる音声は使えません)。',
        TRAINING_EXTRACT_FAILED: '次のファイルから音声の特徴を抽出できませんでした。({{detail}})',
        TRAINING_NO_MODEL: '学習は終わりましたが、モデルが作成されませんでした。({{detail}})',
        TRAINING_NO_INDEX: '学習は終わりましたが、インデックスを作成できませんでした。({{detail}})',
        TRAINING_PRETRAINED_MISSING: '学習用の事前学習モデルがありません。「ダウンロード管理」から取得してください。',
        TRAINING_PRETRAINED_UNREADABLE:
            '学習用の事前学習モデルを読み込めなかったため、学習を中止しました。「ダウンロード管理」で削除してから取得し直してください。({{detail}})',
        PYTHON_WORKER_EXITED: '処理が予期せず終了しました。({{detail}})',
        PYTHON_ERROR: '処理中にエラーが発生しました。({{detail}})',
        PYTHON_EXIT: '処理が中断されました。モデルを読み込めなかった可能性があります。',
        PYTHON_STOP_TIMEOUT: '実行中の処理を止められませんでした。アプリを再起動してから、もう一度お試しください。',
        INVALID_PATH: 'このファイルは使えません。新しい作業を始めて、もう一度やり直してください。',
        DATA_FILE_CORRUPT: 'データファイルを読み込めませんでした。ファイルが壊れている可能性があります。({{detail}})',
        AUDIO_INFO_UNKNOWN: '音声ファイルの長さや形式を読み取れませんでした。({{detail}})',
        EXPORT_FOLDER_MISSING: '書き出し先ディレクトリがありません。({{detail}})',
        PRESET_BUILTIN: 'アプリに用意されたプリセットは変更できません。新しいプリセットとして保存してください。',
        TTS_TIMING_INVALID: 'タイミング指定の表の {{detail}} 行目の時間かテキストに誤りがあります。',
        TTS_TIMING_EMPTY: 'タイミング指定の表に行がありません。',
        FFMPEG_FAILED: 'ffmpeg の処理に失敗しました。({{detail}})',
        FFPROBE_FAILED: 'ffprobe の処理に失敗しました。({{detail}})',
        ZIP_OPEN_FAILED: 'zip ファイルを開けませんでした。ファイルが壊れていないか確認してください。({{detail}})',
        ZIP_READ_FAILED:
            'zip ファイルの中身を読み取れませんでした。ファイルが壊れていないか確認してください。({{detail}})',
        ZIP_INVALID_ENTRY: 'zip に不正なファイル名が含まれています。',
    },
};
