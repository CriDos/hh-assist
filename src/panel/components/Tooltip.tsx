import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';

interface TooltipState {
  text: string;
  top: number;
  left: number;
  arrowLeft: number;
  arrowPos: 'top' | 'bottom';
  visible: boolean;
}

export const Tooltip: React.FC = () => {
  const [tooltip, setTooltip] = useState<TooltipState>({
    text: '',
    top: -9999,
    left: -9999,
    arrowLeft: 0,
    arrowPos: 'bottom',
    visible: false
  });

  const tooltipRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    function findTooltipTarget(el: HTMLElement | null): HTMLElement | null {
      while (el && el !== document.body && el !== document.documentElement) {
        if (el.hasAttribute('title')) {
          const t = el.getAttribute('title') || '';
          if (t.trim()) el.setAttribute('data-tooltip', t);
          el.removeAttribute('title');
        }
        if (el.getAttribute('data-tooltip')) {
          return el;
        }
        el = el.parentElement;
      }
      return null;
    }

    function showFor(target: HTMLElement) {
      targetRef.current = target;
      if (target.hasAttribute('title')) {
        const t = target.getAttribute('title') || '';
        if (t.trim()) target.setAttribute('data-tooltip', t);
        target.removeAttribute('title');
      }

      const text = target.getAttribute('data-tooltip') || '';
      if (!text || !text.trim()) {
        hide();
        return;
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!targetRef.current) return;
        setTooltip(prev => ({
          ...prev,
          text,
          visible: true
        }));
      }, 60);
    }

    function hide() {
      if (timerRef.current) clearTimeout(timerRef.current);
      targetRef.current = null;
      setTooltip(prev => (prev.visible ? { ...prev, visible: false } : prev));
    }

    function handleMouseOver(e: Event) {
      const target = findTooltipTarget(e.target as HTMLElement);
      if (target) {
        if (target !== targetRef.current) {
          showFor(target);
        }
      } else {
        hide();
      }
    }

    function handleMouseOut(e: Event) {
      const me = e as MouseEvent;
      const related = me.relatedTarget as HTMLElement | null;
      if (!related || !targetRef.current || !targetRef.current.contains(related)) {
        hide();
      }
    }

    function handleScrollOrClick() {
      hide();
    }

    document.addEventListener('pointerover', handleMouseOver, { passive: true });
    document.addEventListener('pointerout', handleMouseOut, { passive: true });
    document.addEventListener('mouseover', handleMouseOver, { passive: true });
    document.addEventListener('mouseout', handleMouseOut, { passive: true });
    window.addEventListener('scroll', handleScrollOrClick, { passive: true, capture: true });
    document.addEventListener('click', handleScrollOrClick, { passive: true });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('pointerover', handleMouseOver);
      document.removeEventListener('pointerout', handleMouseOut);
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
      window.removeEventListener('scroll', handleScrollOrClick, { capture: true });
      document.removeEventListener('click', handleScrollOrClick);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tooltip.visible || !targetRef.current || !tooltipRef.current) return;

    const targetRect = targetRef.current.getBoundingClientRect();
    const tipRect = tooltipRef.current.getBoundingClientRect();
    if (targetRect.width === 0 && targetRect.height === 0) return;

    let arrowPos: 'top' | 'bottom' = 'bottom';
    let top = targetRect.top - tipRect.height - 7;
    if (top < 6) {
      top = targetRect.bottom + 7;
      arrowPos = 'top';
    }

    let left = targetRect.left + targetRect.width / 2 - tipRect.width / 2;
    const padding = 8;
    const maxLeft = window.innerWidth - tipRect.width - padding;
    left = Math.max(padding, Math.min(maxLeft, left));

    const targetCenter = targetRect.left + targetRect.width / 2;
    let arrowLeft = targetCenter - left - 3;
    arrowLeft = Math.max(8, Math.min(tipRect.width - 14, arrowLeft));

    setTooltip(prev => {
      if (
        prev.top === top &&
        prev.left === left &&
        prev.arrowLeft === arrowLeft &&
        prev.arrowPos === arrowPos
      ) {
        return prev;
      }
      return {
        ...prev,
        top,
        left,
        arrowLeft,
        arrowPos
      };
    });
  }, [tooltip.visible, tooltip.text]);

  if (!tooltip.visible && !tooltip.text) return null;

  return (
    <div
      ref={tooltipRef}
      className={`app-tooltip ${tooltip.visible ? 'visible' : ''}`}
      style={{
        top: `${tooltip.top}px`,
        left: `${tooltip.left}px`
      }}
      role="tooltip"
      aria-hidden={!tooltip.visible}
    >
      <span className="app-tooltip-content">{tooltip.text}</span>
      <span
        className={`app-tooltip-arrow ${tooltip.arrowPos}`}
        style={{ left: `${tooltip.arrowLeft}px` }}
      />
    </div>
  );
};
