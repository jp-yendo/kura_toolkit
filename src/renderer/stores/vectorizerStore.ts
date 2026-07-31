import { create } from 'zustand';

type VectorizerState = {
    imagePath: string | null;
    imageDataUrl: string | null;
    svg: string | null;
    setImage(imagePath: string, imageDataUrl: string): void;
    setSvg(svg: string | null): void;
};

export const useVectorizerStore = create<VectorizerState>(set => ({
    imagePath: null,
    imageDataUrl: null,
    svg: null,
    setImage(imagePath, imageDataUrl) {
        set({ imagePath, imageDataUrl, svg: null });
    },
    setSvg(svg) {
        set({ svg });
    },
}));
