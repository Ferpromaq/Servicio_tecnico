"use client";

import { useCallback, useLayoutEffect, useRef, useState, type TransitionEvent } from "react";

type DrawerTransition = {
  mounted: boolean;
  visible: boolean;
  onTransitionEnd: (event: TransitionEvent<HTMLElement>) => void;
};

export function useDrawerTransition(open: boolean): DrawerTransition {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstFrame = useRef<number | null>(null);
  const secondFrame = useRef<number | null>(null);

  const clearPendingWork = useCallback(() => {
    if (fallbackTimer.current) {
      window.clearTimeout(fallbackTimer.current);
      fallbackTimer.current = null;
    }
    if (firstFrame.current !== null) {
      window.cancelAnimationFrame(firstFrame.current);
      firstFrame.current = null;
    }
    if (secondFrame.current !== null) {
      window.cancelAnimationFrame(secondFrame.current);
      secondFrame.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    clearPendingWork();

    if (open) {
      setMounted(true);
      setVisible(false);
      firstFrame.current = window.requestAnimationFrame(() => {
        firstFrame.current = null;
        secondFrame.current = window.requestAnimationFrame(() => {
          secondFrame.current = null;
          setVisible(true);
        });
      });
      return clearPendingWork;
    }

    setVisible(false);
    fallbackTimer.current = window.setTimeout(() => {
      fallbackTimer.current = null;
      setMounted(false);
    }, 500);

    return clearPendingWork;
  }, [open, clearPendingWork]);

  const onTransitionEnd = useCallback((event: TransitionEvent<HTMLElement>) => {
    if (
      event.target !== event.currentTarget ||
      event.propertyName !== "transform" ||
      open
    ) {
      return;
    }

    clearPendingWork();
    setMounted(false);
  }, [open, clearPendingWork]);

  return { mounted, visible, onTransitionEnd };
}
