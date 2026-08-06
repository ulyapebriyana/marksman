import { useEffect, useRef } from "react";

type Handler = (event: KeyboardEvent) => void;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Global shortcuts. Keys are normalised to lowercase; prefix with `mod+` for
 * ⌘/Ctrl. Handlers never fire while the viewer is typing, except for `mod+`
 * combinations and Escape.
 */
export function useHotkeys(bindings: Record<string, Handler>) {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      const combo = mod ? `mod+${key}` : key;
      const handler = ref.current[combo];
      if (!handler) return;
      if (isTypingTarget(event.target) && !mod && key !== "escape") return;
      handler(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** Two-key "g then x" sequences, the way Linear and GitHub do navigation. */
export function useLeaderKey(leader: string, bindings: Record<string, () => void>) {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();

      if (armed) {
        armed = false;
        clearTimeout(timer);
        const handler = ref.current[key];
        if (handler) {
          event.preventDefault();
          handler();
        }
        return;
      }

      if (key === leader) {
        armed = true;
        timer = setTimeout(() => {
          armed = false;
        }, 1200);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearTimeout(timer);
    };
  }, [leader]);
}
