import { SEPARATOR_MODEL_PREFIX } from '@shared/voice/requirements';
import type { LibraryItem, SeparationArch } from '@shared/voice/types';

// 分離モデルの概要 (ダウンロードの画面と分離の画面に示す)。モデルのファイル名 -> 概要の翻訳キー
// (voice.library.separatorModelNotes.<キー>)。兄弟のモデルとの違いを書くため、概要はモデルごとに持つ。
// 概要は、各作者のモデルカード・UVR や Demucs などの GitHub・deton24 のガイドにある説明から書く。
// 分離のパッケージ一式 (audio-separator) の版を上げたら、一覧に増えたモデルの概要を足す
export const SEPARATOR_MODEL_NOTES: Record<string, string> = {
    '10_SP-UVR-2B-32000-1.pth': 'm_10_SP_UVR_2B_32000_1',
    '11_SP-UVR-2B-32000-2.pth': 'm_11_SP_UVR_2B_32000_2',
    '12_SP-UVR-3B-44100.pth': 'm_12_SP_UVR_3B_44100',
    '13_SP-UVR-4B-44100-1.pth': 'm_13_SP_UVR_4B_44100_1',
    '14_SP-UVR-4B-44100-2.pth': 'm_14_SP_UVR_4B_44100_2',
    '15_SP-UVR-MID-44100-1.pth': 'm_15_SP_UVR_MID_44100_1',
    '16_SP-UVR-MID-44100-2.pth': 'm_16_SP_UVR_MID_44100_2',
    '17_HP-Wind_Inst-UVR.pth': 'm_17_HP_Wind_Inst_UVR',
    '1_HP-UVR.pth': 'm_1_HP_UVR',
    '2_HP-UVR.pth': 'm_2_HP_UVR',
    '3_HP-Vocal-UVR.pth': 'm_3_HP_Vocal_UVR',
    '4_HP-Vocal-UVR.pth': 'm_4_HP_Vocal_UVR',
    '5_HP-Karaoke-UVR.pth': 'm_5_HP_Karaoke_UVR',
    '6_HP-Karaoke-UVR.pth': 'm_6_HP_Karaoke_UVR',
    '7_HP2-UVR.pth': 'm_7_HP2_UVR',
    '8_HP2-UVR.pth': 'm_8_HP2_UVR',
    '9_HP2-UVR.pth': 'm_9_HP2_UVR',
    'aspiration_mel_band_roformer_less_aggr_sdr_18.1201.ckpt': 'm_aspiration_mel_band_roformer_less_aggr_sdr_18_1201',
    'aspiration_mel_band_roformer_sdr_18.9845.ckpt': 'm_aspiration_mel_band_roformer_sdr_18_9845',
    'BS-Roformer-SW.ckpt': 'm_BS_Roformer_SW',
    'bs_roformer_instrumental_resurrection_gabox.ckpt': 'm_bs_roformer_instrumental_resurrection_gabox',
    'bs_roformer_instrumental_resurrection_unwa.ckpt': 'm_bs_roformer_instrumental_resurrection_unwa',
    'bs_roformer_karaoke_anvuew.ckpt': 'm_bs_roformer_karaoke_anvuew',
    'bs_roformer_karaoke_frazer_becruily.ckpt': 'm_bs_roformer_karaoke_frazer_becruily',
    'bs_roformer_male_female_by_aufr33_sdr_7.2889.ckpt': 'm_bs_roformer_male_female_by_aufr33_sdr_7_2889',
    'bs_roformer_vocals_gabox.ckpt': 'm_bs_roformer_vocals_gabox',
    'bs_roformer_vocals_resurrection_unwa.ckpt': 'm_bs_roformer_vocals_resurrection_unwa',
    'bs_roformer_vocals_revive_unwa.ckpt': 'm_bs_roformer_vocals_revive_unwa',
    'bs_roformer_vocals_revive_v2_unwa.ckpt': 'm_bs_roformer_vocals_revive_v2_unwa',
    'bs_roformer_vocals_revive_v3e_unwa.ckpt': 'm_bs_roformer_vocals_revive_v3e_unwa',
    'denoise_mel_band_roformer_aufr33_aggr_sdr_27.9768.ckpt': 'm_denoise_mel_band_roformer_aufr33_aggr_sdr_27_9768',
    'denoise_mel_band_roformer_aufr33_sdr_27.9959.ckpt': 'm_denoise_mel_band_roformer_aufr33_sdr_27_9959',
    'dereverb-echo_mel_band_roformer_sdr_10.0169.ckpt': 'm_dereverb_echo_mel_band_roformer_sdr_10_0169',
    'dereverb-echo_mel_band_roformer_sdr_13.4843_v2.ckpt': 'm_dereverb_echo_mel_band_roformer_sdr_13_4843_v2',
    'dereverb_big_mbr_ep_362.ckpt': 'm_dereverb_big_mbr_ep_362',
    'dereverb_echo_mbr_fused.ckpt': 'm_dereverb_echo_mbr_fused',
    'dereverb_mel_band_roformer_anvuew_sdr_19.1729.ckpt': 'm_dereverb_mel_band_roformer_anvuew_sdr_19_1729',
    'dereverb_mel_band_roformer_less_aggressive_anvuew_sdr_18.8050.ckpt':
        'm_dereverb_mel_band_roformer_less_aggressive_anvuew_sdr_18_8050',
    'dereverb_mel_band_roformer_mono_anvuew.ckpt': 'm_dereverb_mel_band_roformer_mono_anvuew',
    'dereverb_super_big_mbr_ep_346.ckpt': 'm_dereverb_super_big_mbr_ep_346',
    'deverb_bs_roformer_8_384dim_10depth.ckpt': 'm_deverb_bs_roformer_8_384dim_10depth',
    'hdemucs_mmi.yaml': 'm_hdemucs_mmi',
    'htdemucs.yaml': 'm_htdemucs',
    'htdemucs_6s.yaml': 'm_htdemucs_6s',
    'htdemucs_ft.yaml': 'm_htdemucs_ft',
    'Kim_Inst.onnx': 'm_Kim_Inst',
    'Kim_Vocal_1.onnx': 'm_Kim_Vocal_1',
    'Kim_Vocal_2.onnx': 'm_Kim_Vocal_2',
    'kuielab_a_bass.onnx': 'm_kuielab_a_bass',
    'kuielab_a_drums.onnx': 'm_kuielab_a_drums',
    'kuielab_a_other.onnx': 'm_kuielab_a_other',
    'kuielab_a_vocals.onnx': 'm_kuielab_a_vocals',
    'kuielab_b_bass.onnx': 'm_kuielab_b_bass',
    'kuielab_b_drums.onnx': 'm_kuielab_b_drums',
    'kuielab_b_other.onnx': 'm_kuielab_b_other',
    'kuielab_b_vocals.onnx': 'm_kuielab_b_vocals',
    'MDX23C-8KFFT-InstVoc_HQ.ckpt': 'm_MDX23C_8KFFT_InstVoc_HQ',
    'MDX23C-De-Reverb-aufr33-jarredou.ckpt': 'm_MDX23C_De_Reverb_aufr33_jarredou',
    'MDX23C-DrumSep-aufr33-jarredou.ckpt': 'm_MDX23C_DrumSep_aufr33_jarredou',
    'mel_band_roformer_bleed_suppressor_v1.ckpt': 'm_mel_band_roformer_bleed_suppressor_v1',
    'mel_band_roformer_crowd_aufr33_viperx_sdr_8.7144.ckpt': 'm_mel_band_roformer_crowd_aufr33_viperx_sdr_8_7144',
    'mel_band_roformer_denoise_debleed_gabox.ckpt': 'm_mel_band_roformer_denoise_debleed_gabox',
    'mel_band_roformer_instrumental_2_gabox.ckpt': 'm_mel_band_roformer_instrumental_2_gabox',
    'mel_band_roformer_instrumental_3_gabox.ckpt': 'm_mel_band_roformer_instrumental_3_gabox',
    'mel_band_roformer_instrumental_becruily.ckpt': 'm_mel_band_roformer_instrumental_becruily',
    'mel_band_roformer_instrumental_bleedless_v1_gabox.ckpt': 'm_mel_band_roformer_instrumental_bleedless_v1_gabox',
    'mel_band_roformer_instrumental_bleedless_v2_gabox.ckpt': 'm_mel_band_roformer_instrumental_bleedless_v2_gabox',
    'mel_band_roformer_instrumental_bleedless_v3_gabox.ckpt': 'm_mel_band_roformer_instrumental_bleedless_v3_gabox',
    'mel_band_roformer_instrumental_fullness_noise_v4_gabox.ckpt':
        'm_mel_band_roformer_instrumental_fullness_noise_v4_gabox',
    'mel_band_roformer_instrumental_fullness_v1_gabox.ckpt': 'm_mel_band_roformer_instrumental_fullness_v1_gabox',
    'mel_band_roformer_instrumental_fullness_v2_gabox.ckpt': 'm_mel_band_roformer_instrumental_fullness_v2_gabox',
    'mel_band_roformer_instrumental_fullness_v3_gabox.ckpt': 'm_mel_band_roformer_instrumental_fullness_v3_gabox',
    'mel_band_roformer_instrumental_fullness_v4_gabox.ckpt': 'm_mel_band_roformer_instrumental_fullness_v4_gabox',
    'mel_band_roformer_instrumental_fv7z_gabox.ckpt': 'm_mel_band_roformer_instrumental_fv7z_gabox',
    'mel_band_roformer_instrumental_fv8_gabox.ckpt': 'm_mel_band_roformer_instrumental_fv8_gabox',
    'mel_band_roformer_instrumental_fv8b_gabox.ckpt': 'm_mel_band_roformer_instrumental_fv8b_gabox',
    'mel_band_roformer_instrumental_fvx_gabox.ckpt': 'm_mel_band_roformer_instrumental_fvx_gabox',
    'mel_band_roformer_instrumental_gabox.ckpt': 'm_mel_band_roformer_instrumental_gabox',
    'mel_band_roformer_instrumental_instv5_gabox.ckpt': 'm_mel_band_roformer_instrumental_instv5_gabox',
    'mel_band_roformer_instrumental_instv5n_gabox.ckpt': 'm_mel_band_roformer_instrumental_instv5n_gabox',
    'mel_band_roformer_instrumental_instv6_gabox.ckpt': 'm_mel_band_roformer_instrumental_instv6_gabox',
    'mel_band_roformer_instrumental_instv6n_gabox.ckpt': 'm_mel_band_roformer_instrumental_instv6n_gabox',
    'mel_band_roformer_instrumental_instv7_gabox.ckpt': 'm_mel_band_roformer_instrumental_instv7_gabox',
    'mel_band_roformer_instrumental_instv7n_gabox.ckpt': 'm_mel_band_roformer_instrumental_instv7n_gabox',
    'mel_band_roformer_instrumental_instv8_gabox.ckpt': 'm_mel_band_roformer_instrumental_instv8_gabox',
    'mel_band_roformer_instrumental_instv8n_gabox.ckpt': 'm_mel_band_roformer_instrumental_instv8n_gabox',
    'mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt': 'm_mel_band_roformer_karaoke_aufr33_viperx_sdr_10_1956',
    'mel_band_roformer_karaoke_becruily.ckpt': 'm_mel_band_roformer_karaoke_becruily',
    'mel_band_roformer_karaoke_gabox.ckpt': 'm_mel_band_roformer_karaoke_gabox',
    'mel_band_roformer_karaoke_gabox_v2.ckpt': 'm_mel_band_roformer_karaoke_gabox_v2',
    'mel_band_roformer_kim_ft2_bleedless_unwa.ckpt': 'm_mel_band_roformer_kim_ft2_bleedless_unwa',
    'mel_band_roformer_kim_ft2_unwa.ckpt': 'm_mel_band_roformer_kim_ft2_unwa',
    'mel_band_roformer_kim_ft3_unwa.ckpt': 'm_mel_band_roformer_kim_ft3_unwa',
    'mel_band_roformer_kim_ft_unwa.ckpt': 'm_mel_band_roformer_kim_ft_unwa',
    'mel_band_roformer_vocal_fullness_aname.ckpt': 'm_mel_band_roformer_vocal_fullness_aname',
    'mel_band_roformer_vocals_becruily.ckpt': 'm_mel_band_roformer_vocals_becruily',
    'mel_band_roformer_vocals_fv1_gabox.ckpt': 'm_mel_band_roformer_vocals_fv1_gabox',
    'mel_band_roformer_vocals_fv2_gabox.ckpt': 'm_mel_band_roformer_vocals_fv2_gabox',
    'mel_band_roformer_vocals_fv3_gabox.ckpt': 'm_mel_band_roformer_vocals_fv3_gabox',
    'mel_band_roformer_vocals_fv4_gabox.ckpt': 'm_mel_band_roformer_vocals_fv4_gabox',
    'mel_band_roformer_vocals_fv5_gabox.ckpt': 'm_mel_band_roformer_vocals_fv5_gabox',
    'mel_band_roformer_vocals_fv6_gabox.ckpt': 'm_mel_band_roformer_vocals_fv6_gabox',
    'mel_band_roformer_vocals_fv7b_gabox.ckpt': 'm_mel_band_roformer_vocals_fv7b_gabox',
    'mel_band_roformer_vocals_gabox.ckpt': 'm_mel_band_roformer_vocals_gabox',
    'mel_band_roformer_vocals_v2_gabox.ckpt': 'm_mel_band_roformer_vocals_v2_gabox',
    'melband_roformer_big_beta4.ckpt': 'm_melband_roformer_big_beta4',
    'melband_roformer_big_beta5e.ckpt': 'm_melband_roformer_big_beta5e',
    'melband_roformer_big_beta6.ckpt': 'm_melband_roformer_big_beta6',
    'melband_roformer_big_beta6x.ckpt': 'm_melband_roformer_big_beta6x',
    'melband_roformer_inst_v1.ckpt': 'm_melband_roformer_inst_v1',
    'melband_roformer_inst_v1_plus.ckpt': 'm_melband_roformer_inst_v1_plus',
    'melband_roformer_inst_v1e.ckpt': 'm_melband_roformer_inst_v1e',
    'melband_roformer_inst_v1e_plus.ckpt': 'm_melband_roformer_inst_v1e_plus',
    'melband_roformer_inst_v2.ckpt': 'm_melband_roformer_inst_v2',
    'melband_roformer_instvoc_duality_v1.ckpt': 'm_melband_roformer_instvoc_duality_v1',
    'melband_roformer_instvox_duality_v2.ckpt': 'm_melband_roformer_instvox_duality_v2',
    'MelBandRoformerBigSYHFTV1.ckpt': 'm_MelBandRoformerBigSYHFTV1',
    'MelBandRoformerSYHFT.ckpt': 'm_MelBandRoformerSYHFT',
    'MelBandRoformerSYHFTV2.5.ckpt': 'm_MelBandRoformerSYHFTV2_5',
    'MelBandRoformerSYHFTV2.ckpt': 'm_MelBandRoformerSYHFTV2',
    'MelBandRoformerSYHFTV3Epsilon.ckpt': 'm_MelBandRoformerSYHFTV3Epsilon',
    'MGM_HIGHEND_v4.pth': 'm_MGM_HIGHEND_v4',
    'MGM_LOWEND_A_v4.pth': 'm_MGM_LOWEND_A_v4',
    'MGM_LOWEND_B_v4.pth': 'm_MGM_LOWEND_B_v4',
    'MGM_MAIN_v4.pth': 'm_MGM_MAIN_v4',
    'model_bs_roformer_ep_317_sdr_12.9755.ckpt': 'm_model_bs_roformer_ep_317_sdr_12_9755',
    'model_bs_roformer_ep_368_sdr_12.9628.ckpt': 'm_model_bs_roformer_ep_368_sdr_12_9628',
    'model_bs_roformer_ep_937_sdr_10.5309.ckpt': 'm_model_bs_roformer_ep_937_sdr_10_5309',
    'model_chorus_bs_roformer_ep_267_sdr_24.1275.ckpt': 'm_model_chorus_bs_roformer_ep_267_sdr_24_1275',
    'model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt': 'm_model_mel_band_roformer_ep_3005_sdr_11_4360',
    'Reverb_HQ_By_FoxJoy.onnx': 'm_Reverb_HQ_By_FoxJoy',
    'UVR-BVE-4B_SN-44100-1.pth': 'm_UVR_BVE_4B_SN_44100_1',
    'UVR-BVE-4B_SN-44100-2.pth': 'm_UVR_BVE_4B_SN_44100_2',
    'UVR-De-Echo-Aggressive.pth': 'm_UVR_De_Echo_Aggressive',
    'UVR-De-Echo-Normal.pth': 'm_UVR_De_Echo_Normal',
    'UVR-De-Reverb-aufr33-jarredou.pth': 'm_UVR_De_Reverb_aufr33_jarredou',
    'UVR-DeEcho-DeReverb.pth': 'm_UVR_DeEcho_DeReverb',
    'UVR-DeNoise-Lite.pth': 'm_UVR_DeNoise_Lite',
    'UVR-DeNoise.pth': 'm_UVR_DeNoise',
    'UVR-MDX-NET-Inst_1.onnx': 'm_UVR_MDX_NET_Inst_1',
    'UVR-MDX-NET-Inst_2.onnx': 'm_UVR_MDX_NET_Inst_2',
    'UVR-MDX-NET-Inst_3.onnx': 'm_UVR_MDX_NET_Inst_3',
    'UVR-MDX-NET-Inst_HQ_1.onnx': 'm_UVR_MDX_NET_Inst_HQ_1',
    'UVR-MDX-NET-Inst_HQ_2.onnx': 'm_UVR_MDX_NET_Inst_HQ_2',
    'UVR-MDX-NET-Inst_HQ_3.onnx': 'm_UVR_MDX_NET_Inst_HQ_3',
    'UVR-MDX-NET-Inst_HQ_4.onnx': 'm_UVR_MDX_NET_Inst_HQ_4',
    'UVR-MDX-NET-Inst_HQ_5.onnx': 'm_UVR_MDX_NET_Inst_HQ_5',
    'UVR-MDX-NET-Inst_Main.onnx': 'm_UVR_MDX_NET_Inst_Main',
    'UVR-MDX-NET-Voc_FT.onnx': 'm_UVR_MDX_NET_Voc_FT',
    'UVR-MDX-NET_Crowd_HQ_1.onnx': 'm_UVR_MDX_NET_Crowd_HQ_1',
    'UVR_MDXNET_1_9703.onnx': 'm_UVR_MDXNET_1_9703',
    'UVR_MDXNET_2_9682.onnx': 'm_UVR_MDXNET_2_9682',
    'UVR_MDXNET_3_9662.onnx': 'm_UVR_MDXNET_3_9662',
    'UVR_MDXNET_9482.onnx': 'm_UVR_MDXNET_9482',
    'UVR_MDXNET_KARA.onnx': 'm_UVR_MDXNET_KARA',
    'UVR_MDXNET_KARA_2.onnx': 'm_UVR_MDXNET_KARA_2',
    'UVR_MDXNET_Main.onnx': 'm_UVR_MDXNET_Main',
    'vocals_mel_band_roformer.ckpt': 'm_vocals_mel_band_roformer',
};

// 一覧に出力の名前が無いモデルの出力 (配布元の各モデルの設定ファイルにある名前)
export const SEPARATOR_MODEL_OUTPUTS: Record<string, string[]> = {
    'BS-Roformer-SW.ckpt': ['bass', 'drums', 'other', 'vocals', 'guitar', 'piano'],
    'bs_roformer_instrumental_resurrection_gabox.ckpt': ['vocals', 'other'],
    'bs_roformer_instrumental_resurrection_unwa.ckpt': ['vocals', 'other'],
    'bs_roformer_karaoke_anvuew.ckpt': ['vocals', 'instrumental'],
    'bs_roformer_karaoke_frazer_becruily.ckpt': ['vocals', 'instrumental'],
    'bs_roformer_male_female_by_aufr33_sdr_7.2889.ckpt': ['male', 'female'],
    'bs_roformer_vocals_gabox.ckpt': ['vocals', 'instrumental'],
    'bs_roformer_vocals_resurrection_unwa.ckpt': ['vocals', 'other'],
    'bs_roformer_vocals_revive_unwa.ckpt': ['vocals', 'other'],
    'bs_roformer_vocals_revive_v2_unwa.ckpt': ['vocals', 'other'],
    'bs_roformer_vocals_revive_v3e_unwa.ckpt': ['vocals', 'other'],
    'dereverb_big_mbr_ep_362.ckpt': ['dry', 'other'],
    'dereverb_echo_mbr_fused.ckpt': ['dry', 'other'],
    'dereverb_mel_band_roformer_mono_anvuew.ckpt': ['noreverb', 'reverb'],
    'dereverb_super_big_mbr_ep_346.ckpt': ['dry', 'other'],
    'mel_band_roformer_denoise_debleed_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_2_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_3_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_becruily.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_bleedless_v1_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_bleedless_v2_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_bleedless_v3_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_fullness_noise_v4_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_fullness_v1_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_fullness_v2_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_fullness_v3_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_fullness_v4_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_fv7z_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_fv8_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_fv8b_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_fvx_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_instv5_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_instv5n_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_instv6_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_instv6n_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_instv7_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_instv7n_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_instv8_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_instrumental_instv8n_gabox.ckpt': ['instrumental', 'vocals'],
    'mel_band_roformer_karaoke_becruily.ckpt': ['vocals', 'instrumental'],
    'mel_band_roformer_karaoke_gabox.ckpt': ['vocals', 'instrumental'],
    'mel_band_roformer_karaoke_gabox_v2.ckpt': ['vocals', 'instrumental'],
    'mel_band_roformer_kim_ft2_bleedless_unwa.ckpt': ['vocals', 'other'],
    'mel_band_roformer_kim_ft2_unwa.ckpt': ['vocals', 'other'],
    'mel_band_roformer_kim_ft3_unwa.ckpt': ['vocals', 'other'],
    'mel_band_roformer_vocal_fullness_aname.ckpt': ['vocals', 'other'],
    'mel_band_roformer_vocals_becruily.ckpt': ['vocals', 'other'],
    'mel_band_roformer_vocals_fv1_gabox.ckpt': ['vocals', 'instrumental'],
    'mel_band_roformer_vocals_fv2_gabox.ckpt': ['vocals', 'instrumental'],
    'mel_band_roformer_vocals_fv3_gabox.ckpt': ['vocals', 'instrumental'],
    'mel_band_roformer_vocals_fv4_gabox.ckpt': ['vocals', 'instrumental'],
    'mel_band_roformer_vocals_fv5_gabox.ckpt': ['vocals', 'instrumental'],
    'mel_band_roformer_vocals_fv6_gabox.ckpt': ['vocals', 'instrumental'],
    'mel_band_roformer_vocals_fv7b_gabox.ckpt': ['vocals', 'instrumental'],
    'mel_band_roformer_vocals_gabox.ckpt': ['vocals', 'instrumental'],
    'mel_band_roformer_vocals_v2_gabox.ckpt': ['vocals', 'instrumental'],
    'melband_roformer_big_beta6.ckpt': ['vocals', 'other'],
    'melband_roformer_big_beta6x.ckpt': ['vocals', 'other'],
    'melband_roformer_inst_v1_plus.ckpt': ['other', 'vocals'],
    'melband_roformer_inst_v1e_plus.ckpt': ['other', 'vocals'],
};

// 方式の表示名
export const SEPARATOR_ARCH_LABELS: Record<SeparationArch, string> = {
    MDX: 'MDX-Net',
    VR: 'VR Arch',
    Demucs: 'Demucs',
    MDXC: 'MDXC (Roformer)',
};

// 画面に示すモデル名。audio-separator の名前の先頭の方式の前置き (「Roformer Model: 」「VR Arch Single Model v5: 」
// 「Demucs v4: 」など) を除く (方式は説明の行に別に示すため。長い名前が欄に入りきらず途切れないようにする)
export function separatorDisplayName(name: string): string {
    return name.replace(/^(?:[^:]*\bModel\b[^:]*|Demucs[^:]*):\s*/, '') || name;
}

// 名前・ファイル名・概要・出力に、空白で区切った語がすべて含まれるものに絞り込む (分離のモデルのタブと、加工の使うモデルの欄)
export function filterSeparatorModels<T extends { filename: string; name: string; stems: string[] }>(
    t: (key: string) => string,
    models: T[],
    input: string
): T[] {
    const terms = input.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return models;
    return models.filter(model => {
        const note = separatorFileNoteKey(model.filename);
        const text = [
            model.name,
            model.filename,
            note ? t(note) : '',
            separatorFileOutputs(model.filename, model.stems).join(' '),
        ]
            .join('\n')
            .toLowerCase();
        return terms.every(term => text.includes(term));
    });
}

export function separatorFilename(item: LibraryItem): string {
    return item.id.slice(SEPARATOR_MODEL_PREFIX.length);
}

// 分離モデルの概要の翻訳キー (概要が無ければ undefined)
export function separatorNoteKey(item: LibraryItem): string | undefined {
    return separatorFileNoteKey(separatorFilename(item));
}

// モデルのファイル名から、分離モデルの概要の翻訳キーを得る (概要が無ければ undefined)
export function separatorFileNoteKey(filename: string): string | undefined {
    const note = SEPARATOR_MODEL_NOTES[filename];
    return note ? `voice.library.separatorModelNotes.${note}` : undefined;
}

// 分離モデルの出力 (一覧に名前が無いモデルは、設定ファイルにある名前)
export function separatorOutputs(item: LibraryItem): string[] {
    return separatorFileOutputs(separatorFilename(item), item.separator?.stems ?? []);
}

export function separatorFileOutputs(filename: string, stems: string[]): string[] {
    return stems.length > 0 ? stems : (SEPARATOR_MODEL_OUTPUTS[filename] ?? []);
}
