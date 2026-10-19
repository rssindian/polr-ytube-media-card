const original = (window as any).__polrOriginalDefine;
if (original) {
    customElements.define = original;
    delete (window as any).__polrOriginalDefine;
}
export {};
