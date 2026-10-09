// Audio separation and processing, voice conversion and text to speech (English)
export default {
    common: {
        back: 'Back',
        next: 'Next',
        ok: 'OK',
        save: 'Save',
        discard: 'Discard',
        retry: 'Retry',
        loading: 'Loading',
        cancelled: 'Cancelled.',
        newWork: 'New Work',
        newWorkConfirm:
            'Discard the current work (candidates and other results) and start new work? Results you have not exported will be lost.',
        listSeparator: ', ',
        waitingGpu: 'Waiting for another task to finish (this can take a while during model training)',
        deleteCandidate: 'Remove candidate',
        on: 'On',
        off: 'Off',
    },
    sections: {
        convert: 'Convert',
        read: 'Read Aloud',
        models: 'Voice Models',
        training: 'Model Training',
    },
    features: {
        separation: 'Audio Separation & Processing',
        conversion: 'Voice Conversion',
        conversionTraining: 'Voice Conversion model training',
        tts: 'Text to Speech',
        ttsTraining: 'Text to Speech model training',
    },
    modelType: {
        'jp-extra': 'JP-Extra',
        multilingual: 'Multilingual',
    },
    languages: {
        ja: 'Japanese',
        en: 'English',
        zh: 'Chinese',
    },
    platform: {
        unsupportedTitle: 'Voice features are not available on this system',
        unsupported: {
            os: 'Audio Separation & Processing, Voice Conversion and Text to Speech are available on Windows, macOS and Linux.',
            arch: 'Audio Separation & Processing, Voice Conversion and Text to Speech are available on 64-bit Windows (x64), macOS and 64-bit Linux (x64 and Arm64), because the libraries used by the voice features are not distributed for this system.',
        },
        featureUnavailableTitle: 'This feature is not available on this system',
        // Why a whole feature cannot be used (shown in the menus, on the dashboard and on each screen)
        torchUnavailable: {
            intelMac:
                'Not available on Intel Macs, because the libraries this feature uses (PyTorch and others) are not distributed for Intel Macs.',
            macosVersion:
                'macOS 14 (Sonoma) or later is required, because the libraries this feature uses (PyTorch and others) are not distributed for macOS 13 or earlier.',
        },
        // Why the separation models (processing that uses a model) cannot be used
        modelsUnavailable: {
            intelMac:
                'Processing that uses a model is not available on Intel Macs, because the libraries the separation models use (PyTorch and others) are not distributed for Intel Macs.',
            macosVersion:
                'Processing that uses a model requires macOS 14 (Sonoma) or later, because the libraries the separation models use (PyTorch and others) are not distributed for macOS 13 or earlier.',
        },
        cuda: 'NVIDIA GPU ({{name}})',
        mps: 'Apple Silicon GPU',
        cpu: 'CPU (no usable GPU, so processing takes longer)',
    },
    readiness: {
        title: 'Download required',
        message: 'Download the following to use this feature.',
    },
    player: {
        play: 'Play',
        pause: 'Pause',
        stop: 'Stop',
        position: 'Position',
    },
    library: {
        title: 'Voice Feature Downloads',
        open: 'Downloads',
        libraryDir: 'Library',
        modelDir: 'Models',
        changeInSettings: 'Change in settings',
        redetect: 'Detect Again',
        vcRuntimeMissing:
            'The Microsoft Visual C++ Redistributable was not found. The voice features need it, so install it before downloading the package sets.',
        vcRuntimeOpen: 'Open Download Page',
        driverUpdate:
            'The NVIDIA GPU driver is too old to use the GPU. Update the driver to process on the GPU (press "Detect Again" afterwards).',
        nonAsciiPath:
            'A storage location contains non-ASCII characters, so things may not work correctly. Changing it to an ASCII-only location in App Settings is recommended.',
        requirements: {
            separationRuntime: 'Separation runtime',
            separatorModels: 'Separation models',
            conversionRuntime: 'Conversion runtime and helper models',
            conversionExtras: 'For extra features',
            whenFcpe: 'Needed when FCPE is chosen as the pitch extraction method',
            whenSeparateInput:
                'Needed to separate the vocals from the input on the conversion screen (choose separation models on the "Audio Separation & Processing" tab)',
            importedEmbedders: 'For imported voice models',
            importedEmbeddersNote:
                'If an imported voice model was made with a method other than ContentVec, the model for that method is needed. The method is shown in the "Voice Models" list. It has nothing to do with the language of the voice you convert. Voices trained in this app do not need these.',
            conversionTrainingRuntime: 'Training runtime and helper models',
            ttsRuntime: 'Text to Speech runtime',
            ttsLanguageModels: 'Language models for the language read',
            ttsLanguageModelsNote:
                'The language model for the language of the text is needed. Japanese, English and Chinese text is analysed with the language model of that language, whatever the format of the voice model. Under each language model are the ready-to-use models that can read that language.',
            whenJapanese: 'Needed to read Japanese (used by both JP-Extra and multilingual voices)',
            whenEnglish: 'Needed to read English',
            whenChinese: 'Needed to read Chinese',
            ttsTrainingRuntime: 'Training runtime',
            trainingFormat: 'Models for each training format',
            trainingFormatNote:
                'The pretrained model of the format chosen on the training screen (JP-Extra or Multilingual) is needed.',
            whenTrainJpExtra: 'Needed to train in the JP-Extra format',
            whenTrainMultilingual: 'Needed to train in the Multilingual format',
            whenTrainEnglish: 'Needed to train an English voice',
            whenTrainChinese: 'Needed to train a Chinese voice',
            whenTrainJapanese: 'Needed to train a Japanese voice',
            trainingLanguageModels: 'Language model for the training language',
            trainingLanguageModelsNote: 'The language model for the language of the training text is needed.',
            readyModelOption: 'Ready-to-use model (optional)',
        },
        groupTitle: '{{name}} ({{kind}})',
        requirementKinds: {
            all: 'Required',
            anyOf: 'At least one',
            optional: 'Optional',
        },
        separatorArch: 'Method: {{arch}}',
        separatorOutputs: 'Outputs: {{outputs}}',
        separatorRecommendations: 'Recommendations by purpose',
        separatorSingleModels: 'Individual models',
        separatorNoMatch: 'No models match the conditions.',
        separatorEnsemblePartial: '{{installed}} of {{total}} downloaded',
        separatorEnsembleDescriptions: {
            instrumental_clean: 'Aims to keep vocals out of the accompaniment as much as possible.',
            instrumental_full: 'Aims to keep as much of the instruments as possible.',
            instrumental_balanced: 'Balances little noise against the fullness of the instruments.',
            instrumental_low_resource: 'A fast combination for little GPU memory.',
            vocal_balanced: 'Aims for the best overall vocal quality.',
            vocal_clean: 'Aims to keep the instruments out of the vocals as much as possible.',
            vocal_full: 'Aims to keep as much of the vocals as possible, including harmonies.',
            vocal_rvc: 'Suited to making voices for training Voice Conversion (RVC) and similar models.',
            karaoke:
                'A combination of 3 models that separates the lead vocals. Its separation quality (SDR) is higher than a single model (about 10.6 against about 10.2).',
        },
        separatorPurposes: {
            vocals: { title: 'Vocal extraction' },
            accompaniment: { title: 'Accompaniment extraction' },
            both: { title: 'Vocals and accompaniment' },
            denoise: { title: 'Noise removal' },
            dereverb: { title: 'Reverb and echo removal' },
            layers: {
                title: 'Lead, backing and accompaniment',
                note: 'This cannot be done with one combination, so it takes two separations. The first splits vocals and accompaniment; then, on the separation screen, use "Branch" on the separated vocals for the second, which splits them into lead and backing vocals. Both combinations are needed.',
            },
        },
        separatorPurposeLabels: {
            step1: 'First: split into vocals and accompaniment',
            step2: 'Second: split the vocals into lead and backing vocals',
        },
        separatorModelNotes: {
            m_10_SP_UVR_2B_32000_1:
                'An older standard-precision (SP) model that needs little computation. Its bandwidth is narrow (up to about 16 kHz) and its quality is below newer models.',
            m_11_SP_UVR_2B_32000_2:
                'An older standard-precision (SP) model that needs little computation. Its bandwidth is narrow (up to about 16 kHz) and its quality is below newer models.',
            m_12_SP_UVR_3B_44100:
                'An older standard-precision (SP) model that needs little computation. Its quality is below newer models.',
            m_13_SP_UVR_4B_44100_1:
                'An older standard-precision (SP) model that needs little computation. It separates gently, so vocals tend to remain.',
            m_14_SP_UVR_4B_44100_2:
                'An older standard-precision (SP) model that needs little computation. It separates gently, so vocals tend to remain.',
            m_15_SP_UVR_MID_44100_1:
                'An older standard-precision (SP) model that needs little computation. Less clear, but tends to be less noisy.',
            m_16_SP_UVR_MID_44100_2:
                'An older standard-precision (SP) model that needs little computation. Less clear, but tends to be less noisy.',
            m_17_HP_Wind_Inst_UVR:
                'Separates woodwinds (flute, saxophone and the like) from the rest. Use it after extracting the accompaniment. It sometimes picks up strings as woodwinds.',
            m_1_HP_UVR:
                'A higher-precision (HP) model aimed mainly at the accompaniment. Reliable, and keeps drums more strongly than 2_HP.',
            m_2_HP_UVR:
                'A higher-precision (HP) model aimed mainly at the accompaniment. Much faster than 1_HP with a crisp sound, but more vocal residue remains.',
            m_3_HP_Vocal_UVR: 'A higher-precision (HP) model aimed mainly at extracting vocals.',
            m_4_HP_Vocal_UVR: 'A higher-precision (HP) model aimed mainly at extracting vocals.',
            m_5_HP_Karaoke_UVR:
                'Removes the lead vocals and keeps the backing vocals with the accompaniment. Works better on vocals extracted first than on the full song. Its quality is below newer models.',
            m_6_HP_Karaoke_UVR:
                'Removes the lead vocals and keeps the backing vocals with the accompaniment. Works better on vocals extracted first than on the full song. Its quality is below newer models.',
            m_7_HP2_UVR:
                'A large (HP2) accompaniment model. It leaves the least vocal residue of the VR models, at the cost of fullness and some high end. Very slow.',
            m_8_HP2_UVR:
                'A lightly fine-tuned version of 9_HP2 (large, HP2). On its own it is usually worse than 9_HP2; it suits being paired with it in an ensemble.',
            m_9_HP2_UVR:
                'A large (HP2) accompaniment model. Gives the most consistent results across songs. Heavy to run.',
            m_aspiration_mel_band_roformer_less_aggr_sdr_18_1201: 'A gentler version of the breath separation model.',
            m_aspiration_mel_band_roformer_sdr_18_9845:
                'Separates breath sounds from vocals, for mixing work. It also grabs some sounds other than breaths.',
            m_BS_Roformer_SW:
                'Splits into vocals, drums, bass, guitar, piano and other. Top-level quality for every part except vocals and especially strong on guitar and piano, but anything percussive goes to the drums, and finger snaps or foot taps can end up in the vocals.',
            m_bs_roformer_instrumental_resurrection_gabox:
                'A fine-tune of the Resurrection accompaniment model with more fullness (close to Inst V1e).',
            m_bs_roformer_instrumental_resurrection_unwa:
                'A small, fast accompaniment model with fullness between Inst V1e and V1e Plus. It keeps vocals out well, but is muddier than V1e Plus.',
            m_bs_roformer_karaoke_anvuew:
                'Separates the lead vocals from the rest (backing vocals and accompaniment). Full, bright lead vocals, but the lead can leak into the accompaniment; extracting the vocals first prevents this.',
            m_bs_roformer_karaoke_frazer_becruily:
                'Separates the lead vocals from the rest (backing vocals and accompaniment). Especially good with harmonies; ad-libs and multiple leads go to the lead side. It can miss radio-effect vocals.',
            m_bs_roformer_male_female_by_aufr33_sdr_7_2889:
                'A beta model that splits voices into male and female. Extract the vocals first.',
            m_bs_roformer_vocals_gabox: 'A vocal model. No published description was found.',
            m_bs_roformer_vocals_resurrection_unwa: 'A small vocal model with both low bleed and high quality.',
            m_bs_roformer_vocals_revive_unwa:
                'A vocal model fine-tuned from BS-Roformer 1297, with less instrument bleed in the vocals. Experimental.',
            m_bs_roformer_vocals_revive_v2_unwa:
                'The vocal model with the highest bleedless score among published vocal models. Slower to run.',
            m_bs_roformer_vocals_revive_v3e_unwa:
                'A version that pushes vocal fullness to the maximum. It has issues with harmonies and tends to be noisy.',
            m_denoise_mel_band_roformer_aufr33_aggr_sdr_27_9768:
                'Removes noise more strongly; it sometimes deletes parts of the mix such as snares.',
            m_denoise_mel_band_roformer_aufr33_sdr_27_9959:
                'Removes noise, more gently than the VR DeNoise. Also usable for crowd removal.',
            m_dereverb_echo_mel_band_roformer_sdr_10_0169:
                'Removes reverb and echo (delay) together (vocals only). Some harmonies are removed too.',
            m_dereverb_echo_mel_band_roformer_sdr_13_4843_v2:
                'An improved version of the reverb and echo removal model (V1), retrained on many more songs (vocals only). Most harmonies are removed too.',
            m_dereverb_big_mbr_ep_362: 'Removes large reverb (vocals only). Most harmonies are removed too.',
            m_dereverb_echo_mbr_fused:
                'Fuses V2, Big and Super Big into one, removing both small and large reverb at once (vocals only). The version the author recommends.',
            m_dereverb_mel_band_roformer_anvuew_sdr_19_1729:
                'Removes reverb from vocals aggressively (vocals only). The output leans toward mono, and off-center harmonies and instrument residue are removed too.',
            m_dereverb_mel_band_roformer_less_aggressive_anvuew_sdr_18_8050:
                'A gentler version of the vocal reverb removal model (vocals only), chosen for stereo and layered vocals.',
            m_dereverb_mel_band_roformer_mono_anvuew:
                'A vocal reverb removal model with stronger reverb removal (vocals only). Works on mono and speech, but removes less instrument residue and harmony.',
            m_dereverb_super_big_mbr_ep_346:
                'For extremely large reverb; rarely needed (vocals only). Most harmonies are removed too.',
            m_deverb_bs_roformer_8_384dim_10depth:
                'Removes reverb from vocals. It also removes off-center harmonies and vocal effects, so it suits a single voice or speech, not choirs. Some echo can remain.',
            m_hdemucs_mmi:
                'A previous-generation (Hybrid Demucs) model splitting into 4 parts. The fastest Demucs model, but of lower quality.',
            m_htdemucs:
                'The default Demucs v4 model, splitting into vocals, drums, bass and other. Trained on the standard MusDB data plus 800 songs.',
            m_htdemucs_6s:
                'Splits into vocals, drums, bass, guitar, piano and other. Guitar is fair, but piano is poor, and overall bleed is higher than with the 4-part models.',
            m_htdemucs_ft:
                'A fine-tuned version of the default Demucs v4 model, splitting into 4 parts. It takes about 4 times longer and can be slightly better.',
            m_Kim_Inst:
                'An accompaniment model. Cleaner and higher quality than Inst 3, but noisier. Up to about 17.7 kHz.',
            m_Kim_Vocal_1: 'A vocal model.',
            m_Kim_Vocal_2: 'A newer vocal model than Kim Vocal 1. It has a high-frequency cutoff and can be noisy.',
            m_kuielab_a_bass:
                'From the KUIELab entry, a top entry in the 2021 Music Demixing Challenge. Separates the bass from the rest. The version for the track limited to the given training data (A), where it placed 2nd.',
            m_kuielab_a_drums:
                'From the KUIELab entry, a top entry in the 2021 Music Demixing Challenge. Separates the drums from the rest. The version for the track limited to the given training data (A), where it placed 2nd.',
            m_kuielab_a_other:
                'From the KUIELab entry, a top entry in the 2021 Music Demixing Challenge. Separates the instruments other than vocals, drums and bass. The version for the track limited to the given training data (A), where it placed 2nd.',
            m_kuielab_a_vocals:
                'From the KUIELab entry, a top entry in the 2021 Music Demixing Challenge. Separates vocals from the rest. The version for the track limited to the given training data (A), where it placed 2nd.',
            m_kuielab_b_bass:
                'From the KUIELab entry, a top entry in the 2021 Music Demixing Challenge. Separates the bass from the rest. The version for the track allowing other training data (B), where it placed 3rd. Fast, but of average quality.',
            m_kuielab_b_drums:
                'From the KUIELab entry, a top entry in the 2021 Music Demixing Challenge. Separates the drums from the rest. The version for the track allowing other training data (B), where it placed 3rd. Fast, but of average quality.',
            m_kuielab_b_other:
                'From the KUIELab entry, a top entry in the 2021 Music Demixing Challenge. Separates the instruments other than vocals, drums and bass. The version for the track allowing other training data (B), where it placed 3rd. Fast, but of average quality.',
            m_kuielab_b_vocals:
                'From the KUIELab entry, a top entry in the 2021 Music Demixing Challenge. Separates vocals from the rest. The version for the track allowing other training data (B), where it placed 3rd. Fast, but of average quality.',
            m_MDX23C_8KFFT_InstVoc_HQ:
                'Separates vocals and accompaniment over the full band. Gives good results for many songs and recovers the character of the voice well, but leaves more vocals in the accompaniment and can remove breaths.',
            m_MDX23C_De_Reverb_aufr33_jarredou:
                'Removes reverb from vocals, including room reverb. Cleaner than the VR reverb removal, but can make some sounds pinched. Also suits choirs and backing vocals.',
            m_MDX23C_DrumSep_aufr33_jarredou:
                'Splits drums into kick, snare, toms, hi-hat, ride and crash. Extract the drums first. Kick, snare and toms come out clean, but it struggles to tell ride, hi-hat and crash apart.',
            m_mel_band_roformer_bleed_suppressor_v1:
                'Removes vocal residue and other bleed left in an extracted accompaniment. Use it after extracting the accompaniment (for example with Inst V1 or V1e).',
            m_mel_band_roformer_crowd_aufr33_viperx_sdr_8_7144:
                'Removes crowd noise from live recordings. Keeps instruments and vocals better than the MDX-Net crowd model, at the cost of some crowd residue.',
            m_mel_band_roformer_denoise_debleed_gabox:
                'Removes the noise produced by fullness-oriented accompaniment models; it cannot remove vocal residue. Running it on the full song first, then an accompaniment model (such as INSTV6N), gives a clean, full result.',
            m_mel_band_roformer_instrumental_2_gabox:
                'The second version of the base accompaniment model, balancing fullness and bleed.',
            m_mel_band_roformer_instrumental_3_gabox:
                'The third version of the base accompaniment model. Less full and noisier, and some vocal residue can remain.',
            m_mel_band_roformer_instrumental_becruily:
                'An accompaniment model as clean as Inst V1 with less noise, and it keeps vocal chops. Struggles with low-passed vocals.',
            m_mel_band_roformer_instrumental_bleedless_v1_gabox:
                'The first version that emphasizes keeping vocals out of the accompaniment (B).',
            m_mel_band_roformer_instrumental_bleedless_v2_gabox:
                'A version that emphasizes keeping vocals out of the accompaniment (B).',
            m_mel_band_roformer_instrumental_bleedless_v3_gabox:
                'The B version that puts the most weight on keeping vocals out of the accompaniment. It can be muffled.',
            m_mel_band_roformer_instrumental_fullness_noise_v4_gabox:
                'Even fuller than Fullness V4, but with a significant amount of noise.',
            m_mel_band_roformer_instrumental_fullness_v1_gabox:
                'The first version that emphasizes accompaniment fullness (F).',
            m_mel_band_roformer_instrumental_fullness_v2_gabox: 'A version that emphasizes accompaniment fullness (F).',
            m_mel_band_roformer_instrumental_fullness_v3_gabox:
                'A fullness (F) version with fullness close to Inst V1e but less bleed. It can move a saxophone into the vocals.',
            m_mel_band_roformer_instrumental_fullness_v4_gabox:
                'A fullness (F) version that is full without being too noisy. On some songs more vocals bleed in.',
            m_mel_band_roformer_instrumental_fv7z_gabox:
                'Very low vocal bleed and almost no noise. On some songs the reverb or noise of the vocals remains.',
            m_mel_band_roformer_instrumental_fv8_gabox: 'Emphasizes low vocal bleed, with slightly less fullness.',
            m_mel_band_roformer_instrumental_fv8b_gabox:
                'Muddier than Inst V1e Plus but cleaner. It keeps vocal chops.',
            m_mel_band_roformer_instrumental_fvx_gabox: 'A middle ground between INSTV7 and Instrumental 3.',
            m_mel_band_roformer_instrumental_gabox: 'The base accompaniment model, balancing fullness and bleed.',
            m_mel_band_roformer_instrumental_instv5_gabox: 'A version in the INSTV series, which focuses on fullness.',
            m_mel_band_roformer_instrumental_instv5n_gabox: 'The N version of INSTV5: fuller, but noisier.',
            m_mel_band_roformer_instrumental_instv6_gabox:
                'An INSTV version combining traits of the becruily and unwa models. It mistakes fewer instruments for vocals than Inst V1e, but is less full.',
            m_mel_band_roformer_instrumental_instv6n_gabox:
                'The N version of INSTV6: much fuller, but noisier. Running Denoise-Debleed first gives cleaner results.',
            m_mel_band_roformer_instrumental_instv7_gabox:
                'An INSTV version that is fairly full but noisy. Some vocal residue can remain and some instruments can be erased.',
            m_mel_band_roformer_instrumental_instv7n_gabox: 'The N version of INSTV7: fuller, but noisier.',
            m_mel_band_roformer_instrumental_instv8_gabox:
                'Less full than INSTV7, but with less vocal residue and noise.',
            m_mel_band_roformer_instrumental_instv8n_gabox: 'The N version of INSTV8. Reported to leave vocal residue.',
            m_mel_band_roformer_karaoke_aufr33_viperx_sdr_10_1956:
                'Separates the lead vocals from the rest (backing vocals and accompaniment). Surpassed by newer models but more consistent; also removes a little more sound effects.',
            m_mel_band_roformer_karaoke_becruily:
                'Separates the lead vocals from the rest (backing vocals and accompaniment). Full sound and good at telling lead from backing, but two singers singing together both count as lead. Extracting the vocals first is recommended.',
            m_mel_band_roformer_karaoke_gabox:
                'Separates the lead vocals from the rest (backing vocals and accompaniment). Clean lead vocals, but the backing side is lossy.',
            m_mel_band_roformer_karaoke_gabox_v2:
                'The second version of the lead-vocal model; quality is almost the same as the first.',
            m_mel_band_roformer_kim_ft2_bleedless_unwa:
                'A fine-tune of the Kim vocal model that puts keeping instruments out of the vocals first. Very little noise, but it gets muffled easily.',
            m_mel_band_roformer_kim_ft2_unwa:
                'The second fine-tune of the Kim vocal model, with even less instrument bleed in the vocals. The accompaniment can become muffled.',
            m_mel_band_roformer_kim_ft3_unwa:
                'A fine-tune of the Kim vocal model (FT3 preview) aimed at reducing wind instruments leaking into the vocals.',
            m_mel_band_roformer_kim_ft_unwa:
                'A fine-tune of the Kim vocal model. Both bleedless and fullness are better than the original. Vocals can remain in the accompaniment.',
            m_mel_band_roformer_vocal_fullness_aname:
                'A vocal model that emphasizes fullness while keeping noise balanced. Faint vocals can remain in parts without vocals.',
            m_mel_band_roformer_vocals_becruily:
                'A vocal model with high fullness. It extracts screams cleanly, but can put extra reverb into the vocals.',
            m_mel_band_roformer_vocals_fv1_gabox: 'The first version that emphasizes vocal fullness (F).',
            m_mel_band_roformer_vocals_fv2_gabox: 'A version that emphasizes vocal fullness (F).',
            m_mel_band_roformer_vocals_fv3_gabox: 'A version that emphasizes vocal fullness (F).',
            m_mel_band_roformer_vocals_fv4_gabox:
                'A version that strongly emphasizes fullness, giving clean, unmuffled vocals. It captures lead vocals well, so it suits Voice Conversion (RVC) training data, but struggles with backing vocals.',
            m_mel_band_roformer_vocals_fv5_gabox:
                'A version slightly fuller than FV4. It also keeps vocal chops in the vocal stem.',
            m_mel_band_roformer_vocals_fv6_gabox:
                'An experimental version with the most fullness. Picks up backing vocals well, but sometimes mistakes instruments for vocals and has more bleed.',
            m_mel_band_roformer_vocals_fv7b_gabox:
                'An improved FV4 with less bleed that picks up backing vocals well. Noisier than FV4, and synths or parts of instruments can bleed in.',
            m_mel_band_roformer_vocals_gabox: 'An early version of the vocal model.',
            m_mel_band_roformer_vocals_v2_gabox: 'An early version (the second) of the vocal model.',
            m_melband_roformer_big_beta4:
                'A large vocal model with clear, full vocals; also suits making voices for Voice Conversion (RVC) training. Synths can bleed in.',
            m_melband_roformer_big_beta5e:
                'A large vocal model that strongly emphasizes fullness. Good with whispers, but gets grainy noise when the accompaniment is loud. Beta 4 suits Voice Conversion training data better.',
            m_melband_roformer_big_beta6:
                'A conservative large vocal model that emphasizes low bleed. It avoids the noise problem of Beta 5e but has less fullness and is a little muffled.',
            m_melband_roformer_big_beta6x:
                'The largest Mel-Roformer vocal model, keeping bleed low with more fullness. Picks up backing vocals well, but is slow and a little noisy.',
            m_melband_roformer_inst_v1: 'An accompaniment model. Little muffling, but a characteristic noise remains.',
            m_melband_roformer_inst_v1_plus: 'An improved version of the accompaniment model Inst V1, with less noise.',
            m_melband_roformer_inst_v1e:
                'An accompaniment model that strongly emphasizes fullness. Its fullness is consistent across songs, but it is noisy and struggles with flute, saxophone and trumpet.',
            m_melband_roformer_inst_v1e_plus:
                'An improved version of Inst V1e. Less noise, with fullness between V1 and V1e. It removes vocals gently.',
            m_melband_roformer_inst_v2:
                'A larger version in the Inst V1 line with less vocal residue and noise. In exchange it is a little muffled and can miss flutes and similar parts.',
            m_melband_roformer_instvoc_duality_v1:
                'Trained on both vocals and accompaniment, so one model extracts both. Vocals are close to Big Beta 4 but noisier; the accompaniment has little noise but is a little muffled.',
            m_melband_roformer_instvox_duality_v2:
                'An improved version of Duality V1, with slightly better quality and less residue.',
            m_MelBandRoformerBigSYHFTV1: 'A fine-tune of the Kim vocal model with more vocal fullness but more bleed.',
            m_MelBandRoformerSYHFT:
                'An experimental fine-tune of the Kim vocal model. The author advises checking the quality by ear.',
            m_MelBandRoformerSYHFTV2_5: 'A fine-tune of the Kim vocal model, outperformed by newer models.',
            m_MelBandRoformerSYHFTV2:
                'The second experimental fine-tune of the Kim vocal model. The author advises checking the quality by ear.',
            m_MelBandRoformerSYHFTV3Epsilon:
                'A fine-tune of the Kim vocal model with less muffled vocals. Background noise can bleed into the vocals.',
            m_MGM_HIGHEND_v4: 'An older-generation (v4) model that focuses on the high frequencies.',
            m_MGM_LOWEND_A_v4:
                'An older-generation (v4) model that focuses on the low frequencies (trained at 32 kHz).',
            m_MGM_LOWEND_B_v4:
                'An older-generation (v4) model that focuses on the low frequencies, trained with different settings from LOWEND_A.',
            m_MGM_MAIN_v4:
                'The main older-generation (v4) model for removing vocals. It removes vocals well from most songs.',
            m_model_bs_roformer_ep_317_sdr_12_9755:
                'An early BS-Roformer model separating vocals and accompaniment, with better vocals than 1296. The accompaniment tends to be muffled on its own, and it struggles with saxophone.',
            m_model_bs_roformer_ep_368_sdr_12_9628:
                'An early BS-Roformer model separating vocals and accompaniment, with slightly better accompaniment than 1297. The accompaniment tends to be muffled on its own, and it struggles with saxophone.',
            m_model_bs_roformer_ep_937_sdr_10_5309:
                'Separates drums and bass together from the rest. Use it on an extracted accompaniment to avoid vocal residue.',
            m_model_chorus_bs_roformer_ep_267_sdr_24_1275:
                'An experimental model that splits a chorus into male and female voices (trained on Chinese songs). It cannot separate parts where they sing in turn.',
            m_model_mel_band_roformer_ep_3005_sdr_11_4360:
                'The first Mel-Roformer vocal model. It picks up background vocals well, but is slow.',
            m_Reverb_HQ_By_FoxJoy:
                'Removes reverb, from whole mixes as well as vocals, but only for stereo audio and sounds in the center. On a cappella it can damage the singing or remove delay or piano.',
            m_UVR_BVE_4B_SN_44100_1:
                'Splits vocals into lead and backing vocals. Extract the vocals first. When the backing vocals are in the center, set the aggressiveness to 0.',
            m_UVR_BVE_4B_SN_44100_2:
                'Splits vocals into lead and backing vocals. Extract the vocals first. When the backing vocals are in the center, set the aggressiveness to 0.',
            m_UVR_De_Echo_Aggressive: 'Removes echo more strongly than the Normal version.',
            m_UVR_De_Echo_Normal: 'Removes echo. Some songs come out better than with the stronger Aggressive version.',
            m_UVR_De_Reverb_aufr33_jarredou:
                'Removes reverb from vocals. Sounds more natural than the MDX23C De-Reverb but leaves a little reverb. Also suits choirs and vocals with backing vocals.',
            m_UVR_DeEcho_DeReverb:
                'Removes echo and reverb together. It is said to remove mono reverb too, though reports on this differ.',
            m_UVR_DeNoise_Lite: 'Removes noise gently, with less damage to instruments.',
            m_UVR_DeNoise:
                'Removes noise strongly. The result can sound muffled, and synths or bass are sometimes removed.',
            m_UVR_MDX_NET_Inst_1: 'An early model aimed mainly at the accompaniment. Up to about 17.7 kHz.',
            m_UVR_MDX_NET_Inst_2: 'An early model aimed mainly at the accompaniment. Up to about 17.7 kHz.',
            m_UVR_MDX_NET_Inst_3:
                'An early model aimed mainly at the accompaniment. A little muffled, but less noisy. Up to about 17.7 kHz.',
            m_UVR_MDX_NET_Inst_HQ_1:
                'A high-quality (HQ) model aimed mainly at the accompaniment, covering the full band (up to about 22 kHz).',
            m_UVR_MDX_NET_Inst_HQ_2:
                'A high-quality (HQ) model aimed mainly at the accompaniment, with fewer problems removing vocals than HQ_1.',
            m_UVR_MDX_NET_Inst_HQ_3:
                'A high-quality (HQ) model aimed mainly at the accompaniment. It separates fairly aggressively and can move flutes into the vocals.',
            m_UVR_MDX_NET_Inst_HQ_4:
                'A high-quality (HQ) model aimed mainly at the accompaniment, improved over HQ_3. The least muffled of the HQ models, though vocals can remain in fade-outs.',
            m_UVR_MDX_NET_Inst_HQ_5:
                'A high-quality (HQ) model aimed mainly at the accompaniment. Less vocal residue but more muffled. The lightest and fastest of the HQ models, and also good for vocals.',
            m_UVR_MDX_NET_Inst_Main:
                'An early model aimed mainly at the accompaniment. It separates gently, so more vocal residue remains.',
            m_UVR_MDX_NET_Voc_FT:
                'A fine-tuned version of a vocal model (Kim Vocal). Works widely for vocals. Up to about 17.7 kHz.',
            m_UVR_MDX_NET_Crowd_HQ_1:
                'Removes crowd noise from live recordings. It removes most of the crowd, but instruments tend to bleed into the crowd stem and the result can be muffled.',
            m_UVR_MDXNET_1_9703: 'An early vocal model (up to about 14.7 kHz). Its quality is below newer models.',
            m_UVR_MDXNET_2_9682: 'An early vocal model (up to about 14.7 kHz). Its quality is below newer models.',
            m_UVR_MDXNET_3_9662: 'An early vocal model (up to about 14.7 kHz). Its quality is below newer models.',
            m_UVR_MDXNET_9482: 'One of the oldest vocal models. Its quality is below newer models.',
            m_UVR_MDXNET_KARA:
                'Removes the lead vocals and keeps the backing vocals with the accompaniment. It is aggressive and can remove many backing vocals too. For backing vocals in the center, the VR karaoke models suit better.',
            m_UVR_MDXNET_KARA_2:
                'Removes the lead vocals and keeps the backing vocals with the accompaniment. Keeps the detail of the lead vocals well. For backing vocals in the center, the VR karaoke models suit better.',
            m_UVR_MDXNET_Main:
                'An early vocal model. It leaves more of the accompaniment in the vocals than the 9703 model.',
            m_vocals_mel_band_roformer:
                'A vocal model that many fine-tunes are based on. Less muffled than the viperx models, but it can move wind instruments into the vocals and leave some residue.',
        },
        prerequisites: 'Requires: {{items}} (downloaded together when selected)',
        selectMissing: 'Select missing items',
        missingRequired: '{{count}} of the items required for {{feature}} are not downloaded.',
        colName: 'Name',
        colSize: 'Size',
        colStatus: 'Status',
        colLicense: 'License / source',
        approx: 'About {{size}}',
        source: 'Source',
        credit: 'Credit: {{credit}}',
        status: {
            missing: 'Not downloaded',
            installed: 'Downloaded',
            outdated: 'Update needed',
            broken: 'Re-download needed',
        },
        progress: {
            waiting: 'Waiting',
            downloading: 'Downloading',
            installing: 'Extracting / installing',
            done: 'Done',
            failed: 'Failed',
            cancelled: 'Interrupted',
        },
        separatorCategoryCount: '{{name}} ({{count}})',
        separatorFilterArch: 'Method',
        separatorFilterAll: 'All',
        separatorFilterRecommended: 'Recommended',
        separatorRecommendedOnly: 'Recommended only',
        separatorRecommendedOthers: 'Not recommended',
        searchModels: 'Search names, descriptions, licenses and credits',
        installedOnly: 'Downloaded only',
        separatorListHint: 'Download the "Audio Separation package set" to show the list of separation models.',
        separatorListCreating: 'Creating the list of separation models…',
        separatorListFailed: 'Could not create the list of separation models: {{message}}',
        selection: '{{count}} items (including prerequisites) / {{size}} in total',
        selectionNone: 'Select items to download or remove.',
        downloadSelected: 'Download Selected',
        deleteSelected: 'Remove Selected',
        delete: 'Remove',
        downloading: 'Downloading',
        downloaded: 'Download finished.',
        cancelled: 'The download was interrupted. Downloading again resumes where it stopped.',
        resultTitle: 'Some items could not be downloaded',
        resultMessage: 'The following items could not be obtained. Retrying downloads only these items again.',
        retry: 'Retry',
        removeTitle: 'Confirm removal',
        removePythonWarning:
            'Removing Python also removes all package sets (separation, conversion and text to speech).',
        alsoRemovePython: 'Also remove Python',
        removeAffects: 'Until you download them again, the following features will be unavailable: {{features}}',
        removeNote:
            'Downloaded items can be used again after downloading them again. Voice models you trained or imported are not removed here.',
        removed: 'Removed.',
        removeFailed: '{{count}} items could not be removed.',
        ttsTrainingUnavailable: 'Training Text to Speech models on Windows requires an NVIDIA GPU.',
        separatorModelNotFound: 'The files of this model were not found at the distribution source.',
        items: {
            python: 'Python 3.11',
            pythonDesc:
                'The runtime that runs the programs of the voice features (Audio Separation & Processing, Voice Conversion and Text to Speech). It runs in a location of its own, separately from any Python installed on your computer.',
            separatorPackages: 'Audio Separation package set',
            separatorPackagesDesc:
                'The Audio Separation program (python-audio-separator), the libraries it needs (PyTorch and others) and the library for the effects (pedalboard). Used for Audio Separation & Processing and for separating on the Voice Conversion screen. The Xcode Command Line Tools on macOS, or a C/C++ compiler (such as build-essential) on Linux, must be installed first.',
            separatorLitePackagesDesc:
                'The library for the effects (pedalboard) and the libraries for reading and writing audio (numpy and soundfile). On this system, used for the processing in Audio Separation & Processing that does not use a model (effects and silencing the noise in silent parts).',
            converterPackages: 'Voice Conversion package set',
            converterPackagesDesc:
                'The Voice Conversion (RVC) program (Applio) and the libraries it needs (PyTorch and others). Used for Voice Conversion and for training its models.',
            ttsPackages: 'Text to Speech package set',
            ttsPackagesDesc:
                'The Text to Speech program (Style-Bert-VITS2) and the libraries it needs (PyTorch and others). Used for Text to Speech.',
            ttsTrainPackages: 'Text to Speech training package set',
            ttsTrainPackagesDesc:
                'The extra programs needed to train Text to Speech models, and a speaker embedding model that computes the tone (style) of a voice. Used for training Text to Speech models. An NVIDIA GPU is required on Windows.',
            rmvpe: 'Pitch extraction model (RMVPE)',
            rmvpeDesc:
                'Estimates how the pitch of a voice moves. Used in Voice Conversion, for conversion and training, to keep the intonation of the original voice.',
            fcpe: 'Pitch extraction model (FCPE)',
            fcpeDesc:
                'Estimates how the pitch of a voice moves. Used in Voice Conversion when FCPE is chosen for pitch extraction. It is lighter and faster than RMVPE.',
            contentvec: 'Speech feature model (ContentVec)',
            contentvecDesc:
                'Extracts features describing what is being said. Used in Voice Conversion for conversion and training. Training in this app always uses this model, as do most distributed voice models.',
            rvcPretrained: 'Pretrained model for training (40 kHz)',
            rvcPretrainedDesc:
                'A model already trained on many voices. Voice Conversion training starts from it, so a voice can be trained in less time from fewer recordings.',
            embedderSpin: 'Speech feature model (SPIN)',
            embedderSpinDesc:
                'Extracts features describing what is being said (the same role as ContentVec). Used when converting with voice models made with it. It is designed to extract features that depend less on the speaker.',
            embedderSpinV2: 'Speech feature model (SPIN v2)',
            embedderSpinV2Desc:
                'Extracts features describing what is being said (the same role as ContentVec). Used when converting with voice models made with it. An improved version of SPIN.',
            embedderJapaneseHubert: 'Speech feature model (Japanese HuBERT)',
            embedderJapaneseHubertDesc:
                'Extracts features describing what is being said (the same role as ContentVec). Used when converting with voice models made with it. Trained on Japanese speech.',
            embedderChineseHubert: 'Speech feature model (Chinese HuBERT)',
            embedderChineseHubertDesc:
                'Extracts features describing what is being said (the same role as ContentVec). Used when converting with voice models made with it. Trained on Chinese speech.',
            embedderKoreanHubert: 'Speech feature model (Korean HuBERT)',
            embedderKoreanHubertDesc:
                'Extracts features describing what is being said (the same role as ContentVec). Used when converting with voice models made with it. Trained on Korean speech.',
            languageModelJa: 'Japanese language model (DeBERTa)',
            languageModelJaDesc:
                'Decides natural intonation from the meaning and context of Japanese text. Used to read Japanese and to train Japanese Text to Speech models (with both JP-Extra and multilingual voices).',
            languageModelEn: 'English language model (DeBERTa)',
            languageModelEnDesc:
                'Decides natural intonation from the meaning and context of English text. Used to read English and to train English Text to Speech models. Also includes a dictionary for English pronunciation (CMUdict) and related data.',
            languageModelZh: 'Chinese language model (RoBERTa)',
            languageModelZhDesc:
                'Decides natural intonation from the meaning and context of Chinese text. Used to read Chinese and to train Chinese Text to Speech models.',
            ttsTrainJpExtra: 'Pretrained model for training (JP-Extra)',
            ttsTrainJpExtraDesc:
                'The trained model that JP-Extra Text to Speech training starts from. Also includes a model (WavLM) that judges how natural the audio sounds during training.',
            ttsTrainMultilingual: 'Pretrained model for training (Multilingual)',
            ttsTrainMultilingualDesc: 'The trained model that multilingual Text to Speech training starts from.',
            jvnvFemaleJpExtraDesc:
                'A female voice (JP-Extra), made from Japanese speech spoken with emotion (the JVNV corpus). It reads Japanese.',
            jvnvMaleJpExtraDesc:
                'A male voice (JP-Extra), made from Japanese speech spoken with emotion (the JVNV corpus). It reads Japanese.',
            jvnvFemaleMultilingualDesc:
                'A female voice (Multilingual), made from Japanese speech spoken with emotion (the JVNV corpus). Besides Japanese it can read English and Chinese, but with a Japanese accent because the speaker is Japanese.',
            jvnvMaleMultilingualDesc:
                'A male voice (Multilingual), made from Japanese speech spoken with emotion (the JVNV corpus). Besides Japanese it can read English and Chinese, but with a Japanese accent because the speaker is Japanese.',
        },
    },
    update: {
        title: 'Voice feature update',
        message:
            'This version of the app needs the following items to be downloaded again ({{size}} in total). Download them now? You can also update them later from Downloads.',
        later: 'Later',
        run: 'Download and Update',
        done: 'The voice features were updated.',
        failed: 'Some items could not be updated. Retry from Downloads.',
    },
    separation: {
        dropHint: 'Drag & drop an audio (or video) file here\nor click to choose one',
        categories: {
            vocals: 'Vocals and accompaniment (2 stems)',
            multi: 'Instruments (multiple stems)',
            karaoke: 'Lead vocals and backing vocals',
            denoise: 'Noise removal',
            dereverb: 'Reverb and echo removal',
            other: 'Other',
        },
        separateFrom: 'Branch',
        separateFromFor: 'Branch from {{name}}',
        dialogTitle: 'Separate: {{input}}',
        noResults: 'Use "Branch" on a sound to choose a method and separate or process it.',
        recreate: 'Recreate with Other Settings',
        recreateMessage:
            'Recreating removes the following sounds separated from this result (they are removed when the recreation runs). Continue?',
        removeMessage: 'The following sounds will be removed. Continue?',
        renameFor: 'Rename {{name}}',
        saveColumn: 'Save',
        saveTargetFor: 'Save {{name}}',
        exportSummary: 'Sounds to export: {{count}}',
        exportNoTargets: 'Check "Save" on the sounds to export.',
        method: 'Method',
        methodSearch: 'Choose, or filter by name, description or outputs',
        noMatch: 'No matching models',
        methodHint: 'Choosing two or more models decides one result from the results of each model.',
        pickModes: {
            recommended: 'Recommended',
            model: 'Models',
            other: 'Removal & Adjustment',
            effects: 'Effects',
        },
        verifiedEnsemble: 'Combination verified by the distributor ({{count}} models)',
        categoryEmpty: 'No models in this group have been downloaded. You can get them from "Downloads".',
        selectedTitle: 'Selection',
        selectedNone: 'Nothing is selected yet.',
        quality: 'Separation quality: {{values}}',
        algorithm: 'How to decide the result',
        algorithmNotes: {
            avg_wave:
                "Averages the waveforms of the results. Sounds found in only one result get fainter (the distributor's default).",
            median_wave:
                'Uses the middle value of the waveforms at each moment. With three or more models, one result that is off has less effect.',
            min_wave:
                'Uses the value with the smallest magnitude at each moment. Less bleed from other sounds, but parts of the sound can be lost.',
            max_wave:
                'Uses the value with the largest magnitude at each moment. Less is lost, but bleed from other sounds also stays more easily.',
            avg_fft: 'Averages the results per frequency. Sounds found in only one result get fainter.',
            median_fft:
                'Uses the middle value per frequency. With three or more models, one result that is off has less effect.',
            min_fft:
                "Uses the smallest magnitude per frequency. Less bleed, but parts of the sound can be lost (used by the distributor's Vocal Clean).",
            max_fft:
                "Uses the largest magnitude per frequency. Less is lost, but bleed also stays more easily (used by the distributor's Vocal Full).",
            uvr_max_spec:
                'Uses the larger value per frequency, the way UVR (the separation software this library is based on) does. Less is lost, but bleed also stays more easily.',
            uvr_min_spec:
                'Uses the smaller value per frequency, the way UVR (the separation software this library is based on) does. Less bleed, but parts of the sound can be lost.',
        },
        algorithms: {
            avg_wave: 'Average (waveform)',
            median_wave: 'Median (waveform)',
            min_wave: 'Minimum (waveform)',
            max_wave: 'Maximum (waveform)',
            avg_fft: 'Average (spectrum)',
            median_fft: 'Median (spectrum)',
            min_fft: 'Minimum (spectrum)',
            max_fft: 'Maximum (spectrum)',
            uvr_max_spec: 'Maximum (spectrum, UVR method)',
            uvr_min_spec: 'Minimum (spectrum, UVR method)',
        },
        advanced: 'Advanced Settings',
        paramsFor: 'Parameters ({{arch}})',
        defaultParams: 'Default settings',
        params: {
            segmentSize: 'Segment size',
            overlap: 'Overlap',
            overlapCount: 'Overlap count',
            batchSize: 'Batch size',
            hopLength: 'Hop length',
            enableDenoise: 'Denoise',
            windowSize: 'Window size',
            aggression: 'Aggression',
            enableTta: 'TTA (more accurate, slower)',
            enablePostProcess: 'Post-processing',
            postProcessThreshold: 'Post-processing threshold',
            highEndProcess: 'High-end processing',
            shifts: 'Shifts',
            overrideModelSegmentSize: 'Set the segment size',
            pitchShift: 'Pitch shift (semitones)',
            modelDefault: 'Model default',
        },
        run: 'Separate',
        running: 'Separating',
        runProcess: 'Remove & adjust',
        runningProcess: 'Removing & adjusting',
        runEffects: 'Apply effects',
        runningEffects: 'Applying effects',
        presetUnavailable:
            'This preset includes models that have not been downloaded (or a method that cannot be used for this audio). Those were not selected.',
        deleteResult: 'Remove Result',
        rename: 'Rename',
        trackName: 'Name of the sound',
        trackNameHint: 'Leave empty to go back to "{{name}}".',
        invalidateTitle: 'Later results will be invalidated',
        invalidateRun: 'Discard and Change',
    },
    tracks: {
        source: 'Original',
    },
    export: {
        open: 'Export...',
        title: 'Export',
        format: 'Format',
        outputDir: 'Output directory',
        chooseFile: 'Select Save Location',
        resetPath: 'Stop using the chosen location',
        run: 'Export',
        running: 'Exporting',
        done: 'Exported {{count}} files.',
        failed: '{{count}} files could not be exported: {{error}}',
        overwriteTitle: 'Overwrite existing files',
        overwriteMessage:
            '{{count}} files with the same name already exist in the output location. Overwriting cannot be undone. Export anyway?',
        overwriteRun: 'Overwrite and Export',
        duplicate: 'Several files would be written to the same name. Change the file names so that they differ.',
    },
    conversion: {
        steps: {
            input: 'Input & separation',
            convert: 'Conversion',
            mix: 'Mix',
        },
        modeSeparate: 'Song (separate the accompaniment)',
        modeDirect: 'Speech or narration (no accompaniment)',
        modeHint:
            'Songs are split into vocals and accompaniment; only the vocals are converted and then mixed with the accompaniment again. Audio without accompaniment is converted as is.',
        dropHint: 'Drag & drop an audio (or video) file here\nor click to choose one',
        vocalsTrack: 'Sound to convert',
        accompanimentTracks: 'Sounds to mix in as the accompaniment',
        voice: 'Voice model',
        noVoices: 'There are no voice models. Import one in "Voice Models" or create one in "Model Training".',
        pitch: 'Key change (semitones)',
        pitchHint: 'Unless the change is a whole octave (±12), the accompaniment is transposed by the same amount.',
        f0Method: 'Pitch extraction',
        f0Methods: {
            rmvpe: 'RMVPE (recommended)',
            fcpe: 'FCPE',
            crepe: 'CREPE',
            'crepe-tiny': 'CREPE (tiny)',
        },
        indexRate: 'Index influence',
        indexRateHint: 'Higher values make the voice model characteristics stronger.',
        noIndex: 'This model has no index, so this setting has no effect.',
        volumeEnvelope: 'Volume envelope mix',
        volumeEnvelopeHint: 'Lower values follow the loudness changes of the original voice more closely.',
        protect: 'Consonant protection',
        protectHint: 'Lower values protect consonants and breaths more strongly. At 0.5 there is no protection.',
        run: 'Convert',
        running: 'Converting',
        candidates: 'Candidates',
        noCandidates:
            'Choose a voice model and parameters and run the conversion; each result is listed as a candidate.',
        withAccompanimentCreate: 'Listen with the accompaniment',
        withAccompanimentFor: 'Listen to {{name}} with the accompaniment',
        withAccompanimentRendering: 'Mixing with the accompaniment',
        filterTitle: 'Filter: {{name}}',
        filterRun: 'Apply filter',
        filterRunning: 'Applying the filter',
        accompanimentShow: 'Accompaniment ({{count}})',
        paramsSummary: 'Key {{pitch}} / {{f0}} / index {{index}} / envelope {{envelope}} / protect {{protect}}',
        targets: {
            converted: 'Converted Vocals',
            originalVocals: 'Original Vocals',
            withAccompaniment: 'With the accompaniment',
            source: 'Original Audio',
            mix: 'Mix Result',
        },
        invalidateMessage:
            'The input (vocals or accompaniment) has changed, so the existing conversion and mix results can no longer be used. Discard them and continue?',
        exportMix: 'Mix result',
        suffixConverted: 'converted',
        suffixConvertedVocals: 'converted_vocals',
        suffixOriginalVocals: 'original_vocals',
        saveRow: 'Save',
        saveRowFor: 'Save {{name}}',
    },
    filters: {
        muteSilence: 'Silence the noise in silent parts',
        removeSilence: 'Remove silent parts',
        silenceThreshold: 'Silence level (below the peak)',
        silenceLength: 'Only silences longer than',
        secondsValue: '{{value}} s',
        removeReverb: 'Remove reverb and echo (slow)',
        dereverbModelMissing: 'Download a model from the "Reverb and echo removal" recommendations to use this.',
        dereverbModelSelect: 'Model',
        removeNoise: 'Remove noise',
        noiseSimple: 'Simple removal (FFT, fast)',
        noiseWavelet: 'Simple removal (wavelet, fast)',
        noiseModel: 'Remove with a model (slow)',
        noiseModelMissing: 'Download a model from the "Noise removal" recommendations to use this.',
        noiseFloor: 'Noise level',
        noiseReduction: 'Noise reduction',
        waveletNoise: 'Noise level',
        waveletPercent: 'Removal strength',
        noiseModelSelect: 'Model',
        loudness: 'Match the volume',
        loudnessTarget: 'Target loudness',
        summaryMuteSilence: 'silence noise {{db}} dB, {{seconds}} s',
        summaryNoiseSimple: 'noise removal (FFT) {{floor}} dB, {{reduction}} dB',
        summaryNoiseWavelet: 'noise removal (wavelet) {{noise}} dB, {{percent}}%',
        summaryNoiseModel: 'noise removal ({{model}})',
        summaryDereverb: 'reverb and echo removal ({{model}})',
        summaryRemoveSilence: 'silence removal {{db}} dB, {{seconds}} s',
        summaryLoudness: 'volume {{lufs}} LUFS',
        filterTitle: 'Filter: {{name}}',
        filterAllTitle: 'Apply a filter to all audio in the training set',
        filterAll: 'Filter all audio',
        filterFor: 'Filter for {{name}}',
        filterButton: 'Filter',
        process: 'Apply Filters',
        preview: 'Preview',
        processResult: 'Result {{index}}',
        checking: 'Checking the training audio',
        checkFailed: 'Could not check the training audio. Training starts anyway. ({{error}})',
        processing: 'Applying filters',
        original: 'Original',
        confirm: 'Confirm',
        applyAll: 'Apply',
        applyingAll: 'Applying the filter',
        replaced: 'Replaced with the selected audio.',
        appliedAll: 'Applied the filter to all audio.',
        silenceCheckTitle: 'Some audio contains long silences',
        silenceCheckMessage:
            'The following audio contains long silences. Silences are learned as pauses in the speech. "Remove silent parts" in the filter removes them.',
        silenceCheckItem: '{{name}}: {{seconds}} s of silence',
        continueAnyway: 'Continue anyway',
    },
    effects: {
        preset: 'Preset',
        custom: 'Custom',
        eq: 'EQ (equalizer)',
        eqBand: 'Level of {{band}}',
        lowCut: 'Low cut',
        lowCutOff: 'Off',
        eqGroups: {
            voice: 'For voices',
            music: 'For songs and accompaniment',
        },
        eqPresets: {
            flat: 'Flat',
            vocalTidy: 'Tidy vocals',
            removeMuddiness: 'Remove muddiness',
            clarity: 'Clarity',
            vocalBoost: 'Vocal boost',
            speech: 'Speech',
            bassBoost: 'Bass boost',
            trebleBoost: 'Treble boost',
            rock: 'Rock',
            pop: 'Pop',
            ballad: 'Ballad',
            jazz: 'Jazz',
            classical: 'Classical',
            dance: 'Dance',
            hipHop: 'Hip-hop',
            rnb: 'R&B',
            electronic: 'Electronic',
            acoustic: 'Acoustic',
            loudness: 'Loudness',
        },
        compressor: 'Compressor',
        threshold: 'Threshold',
        thresholdHint: 'Sounds louder than this are reduced. The lower it is, the stronger the effect.',
        ratio: 'Ratio',
        attack: 'Attack',
        release: 'Release',
        deesser: 'De-esser',
        deesserIntensity: 'Intensity',
        deesserMax: 'Maximum reduction',
        deesserFrequency: 'Frequency',
        deesserFrequencyHint: 'The higher it is, the higher the band of the "s" sounds it reduces.',
        chorus: 'Chorus',
        chorusRate: 'Rate',
        chorusDepth: 'Depth',
        chorusCentreDelay: 'Centre delay',
        feedback: 'Feedback',
        mix: 'Mix',
        delay: 'Delay',
        delayTime: 'Delay time',
        reverb: 'Reverb',
        reverbPresets: {
            subtle: 'Subtle',
            smallRoom: 'Small room',
            light: 'Light reverb',
            vocal: 'Vocal',
            liveHouse: 'Live house',
            bright: 'Bright',
            warm: 'Warm',
            hall: 'Hall',
            cathedral: 'Cathedral',
        },
        roomSize: 'Room size',
        damping: 'High-frequency damping',
        wetLevel: 'Reverb level',
        dryLevel: 'Original level',
        dryLevelHint: '1 keeps the original level.',
        width: 'Stereo width',
        widthMonoHint: 'Works on stereo sounds. This sound is mono, so it does not change.',
        summaryEq: 'EQ ({{preset}})',
        summaryCompressor: 'Compressor {{threshold}} dB, {{ratio}} : 1',
        summaryDeesser: 'De-esser {{intensity}}',
        summaryChorus: 'Chorus {{mix}}',
        summaryDelay: 'Delay {{seconds}} s, {{mix}}',
        summaryReverb: 'Reverb ({{preset}})',
    },
    mix: {
        vocalGain: 'Vocal volume',
        vocalGainHint: 'At 0 dB, the vocals are as loud as the original vocals.',
        accompanimentGain: 'Accompaniment volume',
        masterGain: 'Master volume',
        preview: 'Create Mix',
        rendering: 'Mixing',
        stale: 'The settings or the selected candidate have changed. Press "Create Mix" to recreate the mix.',
        builtin: {
            standard: 'Unchanged levels',
            vocalForward: 'Vocals forward',
        },
    },
    models: {
        import: 'Import',
        searchHub: 'Search Hugging Face',
        getReadyModels: 'Get Ready-to-Use Models',
        intro: {
            converter: 'Voice models for Voice Conversion (RVC). Models with the icon were trained in this app.',
            tts: 'Voice models for Text to Speech (Style-Bert-VITS2). Models with the icon were trained in this app.',
        },
        empty: 'There are no voice models.',
        name: 'Name',
        details: 'Details',
        actions: 'Actions',
        userModel: 'Trained in this app',
        rvcInfo: 'RVC {{version}} / {{rate}} Hz / index: {{index}} / {{embedder}}',
        indexYes: 'yes',
        indexNo: 'no',
        ttsInfo: '{{modelType}} / {{styles}} styles / format {{version}}',
        languages: 'Languages',
        languagesHint:
            'Choose the languages this multilingual model is used for. It can then only be used for text in those languages.',
        rename: 'Rename',
        editLanguages: 'Change languages',
        duplicateName: 'A model with this name already exists.\nA different name makes them easier to tell apart.',
        export: 'Export',
        exporting: 'Exporting',
        exported: 'The model was exported.',
        imported: 'Imported "{{name}}".',
        delete: 'Delete',
        deleteConfirm: 'Delete "{{name}}"?',
        deleteUserData:
            'This model was created by training or importing, so it cannot be downloaded again. Deleting it moves it to the trash (if the trash cannot be used, it is deleted permanently).',
        deleteReady: 'Ready-to-use models can be downloaded again from Downloads.',
    },
    import: {
        title: 'Import a Voice Model',
        noticeTitle: 'Please read before importing',
        notice: {
            license:
                'Use the model according to its terms of use and license (credit, commercial use, redistribution and usage restrictions).',
            consent:
                'Do not use models made without the permission of the voice owner or the rights holder of the character.',
            misuse: 'Do not use it to deceive others or to infringe their rights, for example for impersonation or deepfakes.',
            responsibility: 'You are responsible for using the model and for its results.',
            converter:
                'Public RVC models include officially distributed ones and paid or free ones, but also models made without permission. Distribution terms differ from model to model.',
            tts: 'The Style-Bert-VITS2 developers also ask users not to use it for impersonation or deepfakes, and to check and follow the terms and license of each model.',
        },
        agree: 'I have read and agree to the above',
        next: 'Agree and Select Files',
        selectHint: {
            converter:
                'Choose a file exported by this app (.zip) or an RVC model (.pth; the search index .index is optional). Zip archives are accepted as well.',
            tts: 'Choose a file exported by this app (.zip) or a Style-Bert-VITS2 model (*.safetensors). The config.json and style_vectors.npy in the same folder are imported with it. A folder or zip containing the model also works.',
        },
        chooseFiles: 'Select Files',
        chooseFolder: 'Select Folder',
        inspecting: 'Checking the files...',
        multipleCandidates: 'Several files that can be imported were found. Choose the one to import.',
        modelFile: 'Model file',
        indexFile: 'Index file',
        sourceKura:
            'This model was exported by this app. It is imported with the name it had, and keeps the mark of a model trained in this app.',
        sourceExternal: 'This model was obtained elsewhere.',
        unsafeTitle: 'The file could not be read safely',
        unsafeMessage: {
            converter:
                'This file contains data other than the weights. The pth format can run code contained in the file when it is loaded, and malicious models have been published in the past. Loading it without restrictions may run code in the file. After loading, only the weights and settings are stored in a safe format, so no risky loading happens afterwards.',
            tts: 'style_vectors.npy contains data other than a numeric array. Loading it without restrictions may run code in the file. After loading, only the numeric array is stored again in a safe format.',
        },
        allowUnsafe: 'I understand the risk and want to load it without restrictions (at my own risk)',
        run: 'Import',
    },
    tts: {
        newText: 'New',
        open: 'Open',
        save: 'Save',
        saveAs: 'Save As',
        saved: 'Saved.',
        inputMode: 'Input method',
        inputModes: {
            normal: 'Normal',
            timed: 'Timed',
        },
        placeholder:
            'Type the text to read here. Each line is read as a separate paragraph.\nControl tags (for example <break time="500ms"/>) set pauses, speed and more.',
        timed: {
            start: 'Start',
            end: 'End',
            text: 'Text',
            textPlaceholder: 'Text to read',
            textOf: 'Text of row {{row}}',
            addRow: 'Add Row',
            insertBelow: 'Insert a row below',
            removeRow: 'Delete the row',
            empty: 'Enter rows with "Add Row", or load a subtitle file with "Open".',
            addRowFirst: 'Add a row first.',
            rowIssue: 'Row {{row}}: {{message}}',
            errorAt: 'Table row {{row}}, text line {{line}}, character {{column}}: {{message}}',
            fixItem: 'Row {{row}} {{line}}:{{column}} {{kind}} "{{from}}" -> "{{to}}"',
            issues: {
                startFormat: 'The start time is not in a valid format (for example 00:01:02.500).',
                endFormat: 'The end time is not in a valid format (for example 00:01:05.000).',
                endBeforeStart: 'The end time must be later than the start time.',
                startAfterLater: 'The start time is later than the start time of a following row.',
                emptyText: 'Enter the text.',
            },
            unsupportedFile: 'This file format is not supported.',
            noLines: 'Nothing to read could be found in the file.',
            skipped:
                '{{count}} parts whose times could not be read were not loaded. To keep the original file, choose where to save when you save.',
            saveInvalidTime: 'The time in row {{row}} is not in a valid format, so the file cannot be saved.',
        },
        language: 'Language',
        modelType: 'Model type',
        languageModelMissing: 'The language model for {{language}} is not downloaded.',
        voice: 'Voice model',
        noVoices:
            'No voice model can be used with this model type and language. Get ready-to-use models or import a model in "Voice Models".',
        style: 'Style',
        speaker: 'Speaker',
        styleWeight: 'Style strength',
        speed: 'Speed',
        pitchScale: 'Pitch',
        intonationScale: 'Intonation',
        advanced: 'Advanced Settings',
        sdpRatio: 'Tempo variation',
        noise: 'Expression variation',
        noiseW: 'Sound length variation',
        paragraphPause: 'Pause between lines',
        readSymbols: 'Read symbols aloud',
        overflowMode: 'When it does not fit in the time',
        overflowHint: 'To change it for a row, write a fit tag in that row.',
        overflow: {
            speedup: 'Speed up to fit',
            overlap: 'Overlap the next row',
            shift: 'Push later rows back',
            warn: 'Warn only',
        },
        cueTime: 'Time',
        cueText: 'Text',
        run: 'Create Audio',
        running: 'Creating audio',
        empty: 'Enter the text to read.',
        hasErrors: 'The audio cannot be created because there are errors. Fix the parts shown.',
        errorAt: 'Line {{line}}, column {{column}}: {{message}}',
        fixesPending:
            'The control tags contain {{count}} places with different letter case or curly quotes. When you create the audio, you will be asked whether to fix them all at once.',
        fixTitle: 'Fix control tags',
        fixMessage:
            'The following places will be fixed before reading aloud (tag and attribute names in lower case, curly quotes replaced by "). Continue?',
        fixItem: '{{line}}:{{column}} {{kind}} "{{from}}" -> "{{to}}"',
        fixKinds: {
            tagNameCase: 'tag name',
            attributeNameCase: 'attribute name',
            curlyQuote: 'quote',
        },
        fixAccept: 'Fix and Create',
        fixReject: 'Stop Without Fixing',
        speedupTitle: 'Some rows need a large speed increase',
        speedupMessage:
            'To fit in their time, the following rows need to be read more than 1.3 times faster. Speed them up and create the audio?',
        factor: 'Required factor',
        speedupAccept: 'Speed Up and Create',
        speedupReject: 'Stop',
        reportTitle: 'Text to Speech result',
        reportAdjusted: 'Rows with adjusted speed:',
        reportAdjustedItem: 'Row {{index}}: {{factor}}x',
        reportOverflows: 'Rows that did not fit in their time:',
        reportOverflowItem: 'Row {{index}}: {{seconds}} s too long',
        exportLabel: 'Text to Speech result',
        discardChanges: 'The text you are editing has not been saved. Discard it and start new text?',
        discardForOpen: 'The text you are editing has not been saved. Discard it and open a file?',
        secondsValue: '{{value}} s',
    },
    tags: {
        groups: {
            ssml: 'SSML',
            custom: 'App-specific',
        },
        open: 'Control Tags',
        title: 'Control tags',
        intro: 'The following tags written with ASCII "<" and ">" control the reading. Choosing an example inserts it at the cursor, or wraps the selected text.',
        insert: 'Insert',
        wrap: 'Wrap',
        saveToFile: 'Save to File',
        saved: 'Saved to a file.',
        fileIntro: 'The following tags written with ASCII "<" and ">" control the reading.',
        break: {
            description: 'Inserts a pause (silence). This tag stands alone; the closing "/" may be omitted.',
            time: 'Length, such as "500ms" or "1.5s"',
            strength: 'Strength: none / x-weak / weak / medium / strong / x-strong',
        },
        prosody: {
            description:
                'Changes the speed, pitch and volume of the wrapped text. When nested, speeds are multiplied and pitch and volume are added.',
            rate: 'Speed: "120%" (relative to the default rate), "+20%", "-20%", or x-slow / slow / medium / fast / x-fast',
            pitch: 'Pitch: "+2st", "-3st" (semitones), "+10%", "-10%", or x-low / low / medium / high / x-high',
            volume: 'Volume: "+6dB", "-3dB", or silent / x-soft / soft / medium / loud / x-loud',
        },
        sub: {
            description: 'Reads the wrapped text as different words (abbreviations, symbols and so on).',
            alias: 'Text to read (required)',
        },
        phoneme: {
            descriptionJa:
                'Sets the reading and accent of the wrapped word (Japanese accent notation).\nWrite the katakana reading in ph and put "\'" right after the mora before the pitch falls. Without "\'" the word is flat. Separate accent phrases with "/".\nHigh and low pitch follow the Tokyo accent rules (if the pitch falls right after the first mora, only the first mora is high; otherwise the first mora is low and the morae from the second up to the one marked with "\'" are high. In a flat word, the morae from the second onward are high).',
            descriptionEn:
                'Sets the pronunciation of the wrapped words in IPA. Separate words with spaces and mark stress with "ˈ" and "ˌ". The Japanese accent notation cannot be used in English text.',
            descriptionZh:
                'Specifies the pronunciation of the enclosed Chinese characters in pinyin, for example to choose the reading of a character with several readings. Each character takes one syllable, so enclose Chinese characters only. The tones are used as written, without automatic tone changes (tone sandhi).',
            phJa: "Katakana reading with accent marks, for example ハ'シ / ハシ' / ハシ",
            phEn: 'IPA pronunciation, for example təˈmɑːtoʊ',
            phZh: 'Pinyin with a tone number (1-4, 5 for the neutral tone) for each character, separated by spaces. Write ü as v. Example: yin2 hang2 (银行)',
            alphabet: 'Optional. x-kana (accent notation) for Japanese, ipa for English, x-pinyin (pinyin) for Chinese',
        },
        fit: {
            description:
                'In timed input, changes how the row is handled when it does not fit in its time, for that row only. It can be written anywhere in the row.',
            mode: 'How to handle it: speedup (speed up to fit) / overlap (overlap the next row) / shift (push later rows back) / warn (report only)',
        },
        escapeTitle: 'Writing tag-like text',
        escape: 'To write text that starts with a known tag name (such as "<break") as plain text, use the entities "&lt;" (<), "&gt;" (>) and "&amp;" (&).\nOther "<...>" text and full-width "＜" "＞" are treated as plain text and follow the symbol reading setting.\nIn timed rows, subtitle formatting marks (<i>, <b>, <u>, <s>, <font>) are kept in the text but not read aloud.',
    },
    tagErrors: {
        unclosedQuote: 'The attribute value quote of the "{{tag}}" tag is not closed.',
        unclosedTag: 'The "{{tag}}" tag is not closed with ">".',
        unexpectedChar: 'The "{{tag}}" tag contains the character "{{value}}", which is not allowed.',
        missingEquals: 'The attribute "{{attribute}}" of the "{{tag}}" tag has no "=" and value.',
        unquotedValue: 'Wrap the value of the attribute "{{attribute}}" of the "{{tag}}" tag in quotes (").',
        unknownAttribute: 'The "{{tag}}" tag has no attribute "{{attribute}}".',
        duplicateAttribute: 'The attribute "{{attribute}}" of the "{{tag}}" tag is duplicated.',
        missingAttribute: 'The "{{tag}}" tag is missing the required attribute "{{attribute}}".',
        invalidValue:
            'The value "{{value}}" of the attribute "{{attribute}}" of the "{{tag}}" tag is invalid ({{format}}).',
        attributeOnClosingTag: 'The closing tag "{{tag}}" cannot have attributes.',
        missingClosingTag: 'The "{{tag}}" tag has no closing tag.',
        nothingToRead: 'There is nothing to read aloud.',
        paragraphTooLong: 'This paragraph is too long to create. Split it by adding line breaks.',
        rowTooLong: 'This row is too long to create. Split it into several rows.',
        unmatchedClosingTag: 'The closing tag "{{tag}}" has no matching opening tag.',
        misnested: 'The tags are not nested correctly. Close "{{expected}}" before "{{tag}}".',
        emptyContent: 'The "{{tag}}" tag does not wrap any text.',
        nestedTagNotAllowed: 'The tag "{{value}}" cannot be placed inside the "{{tag}}" tag.',
        accentNotJapanese: 'The Japanese accent notation can only be used in Japanese text.',
        ipaNotEnglish: 'IPA pronunciations can only be used in English text.',
        pinyinNotChinese: 'Pinyin pronunciations can only be used in Chinese text.',
        pinyinSyllable:
            'The pinyin "{{value}}" cannot be used. Write a syllable followed by a tone number (1-5), such as zhong1.',
        pinyinSurface: 'Enclose only Chinese characters when specifying pinyin.',
        pinyinCount:
            'The number of pinyin syllables ({{value}}) does not match the number of Chinese characters ({{expected}}).',
        accentSyntax: 'Accent notation error "{{value}}": {{accent}}',
        ipaSymbol: 'The phonetic symbol "{{value}}" is not supported.',
        ipaWordCount:
            'The number of pronounced words ({{value}}) does not match the number of wrapped words ({{expected}}).',
        fitNotTimed: 'The "fit" tag can only be used in rows of timed input.',
        duplicateFit: 'A row has more than one "fit" tag.',
        formats: {
            time: 'like "500ms" or "1.5s"',
            strength: 'none / x-weak / weak / medium / strong / x-strong',
            rate: '"120%", "+20%" or a label (above 0%)',
            pitch: '"+2st", "+10%" or a label',
            volume: '"+6dB", "-3dB" or a label',
            alphabet: 'x-kana, ipa or x-pinyin',
            nonEmpty: 'cannot be empty',
            fitMode: 'speedup, overlap, shift or warn',
        },
        accent: {
            empty: 'the reading is empty',
            emptyPhrase: 'a phrase separated by "/" is empty',
            invalidChar: 'only katakana, "\'" and "/" can be used',
            unknownMora: 'this mora (kana combination) cannot be used',
            markAtStart: 'put "\'" after a mora',
            multipleMarks: 'a phrase can have only one "\'"',
            longVowelAtStart: 'there is no mora before "ー"',
            longVowelAfterSokuon: '"ー" cannot follow "ッ"',
        },
    },
    symbols: {
        title: 'Symbol readings ({{language}})',
        edit: 'Edit symbol readings',
        hint: 'These readings are used when "Read symbols aloud" is on. Full-width and half-width characters are separate symbols. Punctuation ({{punctuation}}) always separates the reading and cannot be added here. For symbols whose reading depends on context, register one typical reading and use the sub tag for individual places.',
        symbol: 'Symbol',
        reading: 'Reading',
        add: 'Add',
        delete: 'Remove this symbol',
        resetDefaults: 'Reset to Defaults',
        resetConfirm: 'Reset the list to the defaults? Readings you added or changed will be removed from the list.',
        invalid: 'There are empty, duplicated or punctuation entries.',
    },
    recorder: {
        start: 'Record',
        stop: 'Stop Recording',
        clipping: 'Too loud',
        cancel: 'Cancel recording',
        denied: 'The microphone cannot be used. Allow this app to use the microphone in System Settings.',
        error: 'The microphone could not be started: {{detail}}',
    },
    trainingSets: {
        label: 'Training set',
        none: 'No training sets',
        empty: 'Training audio is saved in a named training set. Create a training set first.',
        ttsDetail: '{{language}} / Sample sentences / {{count}} sentences with audio / {{duration}}',
        ttsCustomDetail: '{{language}} / Your own text / {{count}} audio clips / {{duration}}',
        rvcDetail: '{{count}} items / {{duration}}',
        create: 'New Training Set',
        createAction: 'Create',
        rename: 'Rename',
        renameAction: 'Rename',
        remove: 'Delete Training Set',
        removeAction: 'Delete',
        removeConfirm: 'Delete the training set "{{name}}"? It is moved to the trash.',
        removed: 'The training set "{{name}}" was moved to the trash.',
        name: 'Name',
        mode: 'Mode',
        modes: {
            sentences: 'From sample sentences',
            custom: 'With your own text',
        },
        languageFixed: 'The language and mode cannot be changed after the training set is created.',
    },
    training: {
        running: 'Training the model',
        adding: 'Adding audio',
        rvcGuide:
            'Recordings made in an environment close to the audio you want to convert (microphone, room, and way of speaking or singing) make a better model. Singing and speaking voices both work.',
        addFiles: 'Add Audio Files',
        deleteAudioTitle: 'Delete audio',
        deleteAudioConfirm: 'Delete "{{name}}" from the training set? Deleted audio cannot be restored.',
        deleteSentenceAudioConfirm:
            'Delete the audio of this sentence from the training set? Deleted audio cannot be restored.',
        deleteAudio: 'Delete Audio',
        datasetNote:
            'Recordings and selected audio files are saved in the training set (you can move or delete the original files after adding them). Training sets remain after training.',
        datasetSummary: '{{count}} items / {{duration}} in total',
        datasetEmpty: 'Record your voice or add audio files.',
        duplicateSkipped:
            'These files were not added because files with the same names have already been added: {{names}}',
        dropUnsupported: 'Files of this type cannot be added.',
        recordingName: 'Recording {{date}}',
        rvcShort: 'With less than 10 minutes of audio, the voice characteristics may not be learned well.',
        modelName: 'Model name',
        epochs: 'Epochs',
        epochsFromSteps: 'Calculate from steps',
        epochsFromStepsTitle: 'Calculate Epochs from Steps',
        steps: 'Steps',
        epochsResult: 'Epochs: {{epochs}}',
        epochsConfirm: 'Apply',
        start: 'Start Training',
        rvcNote: 'Depending on the GPU and the amount of audio, training can take several hours.',
        doneTitle: 'Training finished',
        doneMessage: 'The voice model "{{name}}" was created.',
        openModels: 'Open Voice Models',
        ttsUnavailableTitle: 'Text to Speech models cannot be trained on this system',
        ttsUnavailable:
            'Training Text to Speech models on Windows requires an NVIDIA GPU. A model trained on a computer that can train it can be exported and then imported here.',
        ttsGuide:
            'Choose a sentence in the list on the left, then read it aloud and record it, or select an audio file of that sentence being read. You can start with any sentence and skip sentences you do not want to read. The presented sentence is used as is as the transcript of that audio. Split recordings of several sentences into one file per sentence before selecting them.',
        ttsCustomGuide:
            'Add groups. For each group, record audio or select an audio file, and enter the text read in that audio (or select a text file). The text is used as is as the transcript of that audio. Groups with both audio and text are used for training.',
        sentenceIndex: 'Sentence {{index}} / {{total}} ({{id}})',
        recorded: 'Has audio',
        notRecorded: 'No audio',
        rerecord: 'Record Again',
        chooseSentenceFile: 'Select Audio File',
        removeSentenceAudio: 'Delete the audio of this sentence',
        previous: 'Previous',
        next: 'Next',
        progressSummary: '{{recorded}} / {{total}} sentences have audio ({{duration}} in total)',
        addGroup: 'Add Group',
        groupsEmpty: 'Use "Add Group" to add pairs of audio and text.',
        groupTitle: 'Group {{index}}',
        chooseAudioFile: 'Select Audio File',
        groupText: 'Text',
        chooseTextFile: 'Select Text File',
        removeGroup: 'Delete Group',
        removeGroupFor: 'Delete group {{index}}',
        removeGroupAction: 'Delete',
        removeGroupConfirm: 'Delete group {{index}}? Its audio and text cannot be restored.',
        groupSummary: '{{ready}} / {{total}} groups have audio and text ({{duration}} in total)',
        sentenceCounts:
            'Sentences with audio needed for training: at least {{minimum}}, {{recommended}} or more recommended. The more sentences, the better the voice and speaking style are reproduced.',
    },
    // Names of the file types in file dialogs
    fileFilters: {
        audio: 'Audio and video files',
        allFiles: 'All files',
        rvcModel: 'RVC models',
        ttsModel: 'Style-Bert-VITS2 models',
        voiceModel: 'Voice model',
        text: 'Text',
        srt: 'SRT subtitles',
        markdown: 'Markdown',
        subtitles: 'Subtitles (SRT, WebVTT, ASS, SSA, SBV)',
    },
    errors: {
        KURA_CANCELLED: 'Cancelled.',
        SAMPLE_RATE_MISMATCH: 'The synthesized audio clips have different sample rates. ({{detail}})',
        LIBRARY_BUSY: 'This cannot be done while something is being processed. Try again after it finishes.',
        PLATFORM_UNSUPPORTED: 'Voice features are not available on this system.',
        VC_RUNTIME_MISSING: 'The Microsoft Visual C++ Redistributable is required. Install it and try again.',
        PYTHON_MISSING: 'Python has not been downloaded.',
        PYTHON_BROKEN: 'Python could not be started. Download it again from Downloads. ({{detail}})',
        VENV_FAILED: 'The package set could not be prepared. ({{detail}})',
        PIP_FAILED: 'Installing the packages failed. Check your connection and try again. ({{detail}})',
        BUILD_TOOLS_MISSING:
            'The developer tools needed to build a package were not found. Install the Microsoft C++ Build Tools on Windows, the Command Line Tools with "xcode-select --install" on macOS, or a C/C++ compiler (such as build-essential) on Linux, and try again.',
        VERIFY_FAILED: 'The package set could not be installed correctly. Try again. ({{detail}})',
        DOWNLOAD_FAILED: 'The download failed. Check your connection and try again. ({{detail}})',
        PREREQUISITE_FAILED: 'Skipped because a prerequisite could not be obtained.',
        SEPARATION_MODELS_UNAVAILABLE: 'Processing that uses a separation model is not available on this system.',
        SEPARATOR_NOT_INSTALLED:
            'The Audio Separation package set has not been downloaded or needs an update. Get it from Downloads.',
        MODEL_NOT_INSTALLED: 'A required model has not been downloaded.',
        SEPARATOR_MODEL_NOT_FOUND:
            'A file of the separation model was not found at the distribution source. ({{detail}})',
        ENSEMBLE_NOT_FOUND: 'The chosen verified combination is not in the list of separation models. ({{detail}})',
        MODEL_REQUIRED: 'A required model has not been downloaded. Get it from Downloads.',
        MODEL_FILE_MISSING: 'A model file was not found ({{detail}}). Download it again from Downloads.',
        SEPARATION_NO_OUTPUT: 'The separation produced no output.',
        NO_AUDIO_STREAM: 'This file contains no audio.',
        RUBBERBAND_UNAVAILABLE:
            'The configured ffmpeg does not include the rubberband filter (used to transpose the accompaniment and fine-tune the speech speed). Use an ffmpeg build that includes rubberband (for example Gyan.FFmpeg from winget on Windows, ffmpeg from Homebrew on macOS, or the ffmpeg package of your Linux distribution) and review the ffmpeg setting in App Settings.',
        EMBEDDER_MISSING:
            'The speaker feature model used by this voice model ({{detail}}) has not been downloaded. Get it from Downloads.',
        EMBEDDER_UNSUPPORTED: 'The speaker feature method used by this voice model ({{detail}}) is not supported.',
        CONVERSION_FAILED: 'The conversion failed.',
        INVALID_RVC_MODEL: 'The file could not be read as an RVC model. ({{detail}})',
        RVC_VERSION_UNSUPPORTED: 'Unsupported RVC version ({{detail}}).',
        RVC_VOCODER_UNSUPPORTED: 'Unsupported vocoder ({{detail}}).',
        UNSAFE_MODEL: 'This model cannot be read safely.',
        IMPORT_INVALID_FILE: 'This is not a model file exported by this app.',
        IMPORT_WRONG_FEATURE: 'This model belongs to the other feature (Voice Conversion / Text to Speech).',
        IMPORT_FILES_MISSING: 'Some model files are missing ({{detail}}).',
        IMPORT_PTH_NOT_FOUND: 'No RVC model (.pth) was found.',
        IMPORT_NO_FILES: 'No files were chosen.',
        IMPORT_EXPIRED: 'The import was interrupted. Start again.',
        IMPORT_UNSAFE_NOT_ALLOWED: 'Loading without restrictions was not allowed.',
        INVALID_SAFETENSORS: 'The model weights (safetensors) could not be read.',
        TTS_NOT_INSTALLED: 'The Text to Speech package set has not been downloaded.',
        TTS_MODEL_TYPE_MISMATCH: 'The selected model type does not match the type of the voice model.',
        TTS_PARAMS_INVALID: 'A speech setting is out of range. Please check the settings.',
        TTS_LANGUAGE_UNSUPPORTED: 'This voice model does not support the selected language.',
        VOICE_NOT_FOUND: 'The voice model was not found.',
        VOICE_NAME_EMPTY: 'Enter a name.',
        VOICE_LANGUAGES_EMPTY: 'Choose at least one language.',
        VOICE_LANGUAGES_FIXED: 'JP-Extra models are Japanese only.',
        INVALID_TTS_MODEL: 'The files could not be read as a text to speech model. ({{detail}})',
        NLTK_DATA_MISSING:
            'The data needed to read English is missing. Download "English language model (DeBERTa)" again.',
        PINYIN_ALIGN_FAILED:
            'The characters with a pinyin pronunciation could not be aligned with the text. Check the pronunciation.',
        IPA_WORD_SPLIT: 'A pronunciation cannot be set for "{{detail}}". Use the sub tag to set its reading.',
        TTS_TRAINING_UNAVAILABLE: 'Text to Speech models cannot be trained on this system.',
        TTS_MODEL_TYPE_LANGUAGE_MISMATCH: 'This language cannot be trained with this type of model.',
        TTS_CONFIRMATION_EXPIRED: 'This confirmation is no longer valid. Create the audio again.',
        TRAINING_DATA_TOO_SHORT: 'The training audio is too short.',
        TRAINING_DATA_TOO_FEW: 'Too few sentences have audio.',
        TRAINING_FILE_UNREADABLE: 'This training audio file could not be read. ({{detail}})',
        TRAINING_FILE_MISSING:
            'Some audio files of the training set could not be found. Delete that audio, then record it again or select the file again. ({{detail}})',
        TRAINING_SET_NOT_FOUND: 'The training set could not be found.',
        TRAINING_SET_IN_USE: 'This training set cannot be changed or deleted while it is used for training.',
        DEREVERB_MODEL_REQUIRED:
            'No reverb and echo removal model is available. Download a model from the "Reverb and echo removal" recommendations.',
        NOISE_REMOVAL_MODEL_REQUIRED:
            'No noise removal model is available. Download a model from the "Noise removal" recommendations.',
        NOTHING_TO_PROCESS: 'Check at least one kind of processing.',
        STEM_NOT_FOUND: 'The output to use was not found among the model outputs.',
        TRAINING_AUDIO_NOT_FOUND: 'The audio is not in the training set.',
        TRAINING_SET_NAME_EMPTY: 'Enter a name for the training set.',
        TRAINING_SET_LANGUAGE_MISMATCH: 'The language of the training set is not valid.',
        TRAINING_SET_MODE_MISMATCH: 'The mode of the training set is not valid.',
        INVALID_EPOCHS: 'The number of epochs is not valid.',
        INVALID_TEXT: 'The text is not valid.',
        TRAINING_GROUPS_EMPTY: 'There are no groups with both audio and text.',
        TRAINING_GROUP_TEXT_INVALID:
            'The text of these groups could not be converted to readings: group {{detail}}. Check for words or symbols without a known reading, or sentences that are too long.',
        TRAINING_TEXT_INVALID: 'These sentences could not be converted to readings. ({{detail}})',
        INVALID_TRAINING_SET_ID: 'The training set is not valid.',
        SEPARATOR_LIST_OUTDATED:
            'The Audio Separation package set changed, so the list of separation models must be created again. Please try again.',
        UNKNOWN_SENTENCE: 'The sentence is not valid.',
        INVALID_FEATURE: 'The feature is not valid. ({{detail}})',
        INVALID_LANGUAGE: 'The language is not valid. ({{detail}})',
        TRAINING_FAILED: 'Training failed. ({{detail}})',
        TRAINING_STEP_FAILED: 'Training failed partway. ({{detail}})',
        TRAINING_NO_AUDIO: 'No usable audio was found for training (silence and very short audio cannot be used).',
        TRAINING_EXTRACT_FAILED: 'The audio features could not be extracted from these files. ({{detail}})',
        TRAINING_NO_MODEL: 'Training finished, but no model was created. ({{detail}})',
        TRAINING_NO_INDEX: 'Training finished, but the index could not be created. ({{detail}})',
        TRAINING_PRETRAINED_MISSING: 'The pretrained model for training is missing. Get it from Downloads.',
        TRAINING_PRETRAINED_UNREADABLE:
            'Training was stopped because the pretrained model for training could not be loaded. Remove it in Downloads and download it again. ({{detail}})',
        PYTHON_WORKER_EXITED: 'The processing ended unexpectedly. ({{detail}})',
        PYTHON_ERROR: 'An error occurred during processing. ({{detail}})',
        PYTHON_EXIT: 'The processing stopped. The model may not have loaded.',
        PYTHON_STOP_TIMEOUT: 'A running process could not be stopped. Restart the app and try again.',
        INVALID_PATH: 'This file cannot be used. Start new work and try again.',
        DATA_FILE_CORRUPT: 'A data file could not be read. It may be damaged. ({{detail}})',
        AUDIO_INFO_UNKNOWN: 'The length or format of the audio file could not be read. ({{detail}})',
        EXPORT_FOLDER_MISSING: 'The output directory does not exist. ({{detail}})',
        TTS_TIMING_INVALID: 'The time or text in row(s) {{detail}} of the timed table contains errors.',
        TTS_TIMING_EMPTY: 'The timed table has no rows.',
        FFMPEG_FAILED: 'ffmpeg failed. ({{detail}})',
        FFPROBE_FAILED: 'ffprobe failed. ({{detail}})',
        ZIP_OPEN_FAILED: 'The zip file could not be opened. Check that the file is not damaged. ({{detail}})',
        ZIP_READ_FAILED:
            'The contents of the zip file could not be read. Check that the file is not damaged. ({{detail}})',
        ZIP_INVALID_ENTRY: 'The zip archive contains an invalid file name.',
    },
};
