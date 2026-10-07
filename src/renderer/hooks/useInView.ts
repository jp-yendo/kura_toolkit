import React from 'react';

// 要素が画面に見えてきたか (一度見えたら true のまま)。多くの行を並べる一覧で、重い読み込み (波形など) を見えた行から
// 始めるために使う。少し手前 (rootMargin) から見えたものとして扱い、スクロールしたときに空の時間を短くする
export function useInView<T extends Element>(): [React.RefCallback<T>, boolean] {
    const [element, setElement] = React.useState<T | null>(null);
    const [inView, setInView] = React.useState(false);
    React.useEffect(() => {
        if (!element || inView) return;
        const observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting)) setInView(true);
            },
            { rootMargin: '200px 0px' }
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [element, inView]);
    return [setElement, inView];
}
