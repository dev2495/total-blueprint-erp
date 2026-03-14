import { useState, useEffect, useRef } from "react";

export function useInView(options?: IntersectionObserverInit) {
    const [inView, setInView] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const currentRef = ref.current;
        if (!currentRef) return;

        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setInView(true);
                observer.disconnect(); // Trigger animation only once
            }
        }, { threshold: 0.1, ...options });

        observer.observe(currentRef);

        return () => {
            observer.disconnect();
        };
    }, [options]);

    return { ref, inView };
}
