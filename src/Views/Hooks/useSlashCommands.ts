import { useCallback, useState } from "react";
import { getSlashCommands } from "../../SlashCommands.ts";

export function useSlashCommands(
  setInput: (val: string) => void,
  textareaRef: React.RefObject<HTMLTextAreaElement>,
) {
  const [slashSuggestions, setSlashSuggestions] = useState<
    { description: string; name: string }[]
  >([]);
  const [isSlashOpen, setIsSlashOpen] = useState(false);
  const [slashSelectionIndex, setSlashSelectionIndex] = useState(0);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);

  const handleSlashInput = useCallback((text: string) => {
    if (text.startsWith("/")) {
      const parts = text.split(" ");
      const first = parts[0];
      if (first === undefined) {
        return;
      }
      const query = first.slice(1);
      const commands = getSlashCommands();
      const filtered = commands.filter((cmd) => cmd.name.startsWith(query));

      setSlashSuggestions(filtered);
      setIsSlashOpen(filtered.length > 0);
      setSlashSelectionIndex(0);
    } else {
      setIsSlashOpen(false);
      setSlashSuggestions([]);
    }
  }, []);

  const handleSlashKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isSlashOpen && slashSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashSelectionIndex((prev) =>
            prev < slashSuggestions.length - 1 ? prev + 1 : 0,
          );
          return true;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashSelectionIndex((prev) =>
            prev > 0 ? prev - 1 : slashSuggestions.length - 1,
          );
          return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const selected = slashSuggestions[slashSelectionIndex];
          if (selected) {
            setInput(`/${selected.name} `);
            setIsSlashOpen(false);
            setSlashSuggestions([]);
            setTimeout(() => textareaRef.current?.focus(), 0);
          }
          return true;
        }
        if (e.key === "Escape") {
          setIsSlashOpen(false);
          return true;
        }
      }
      return false;
    },
    [isSlashOpen, slashSuggestions, slashSelectionIndex, setInput, textareaRef],
  );

  return {
    slashSuggestions,
    isSlashOpen,
    slashSelectionIndex,
    setSlashSelectionIndex,
    activeCommand,
    setActiveCommand,
    handleSlashInput,
    handleSlashKeyDown,
    setIsSlashOpen,
    setSlashSuggestions,
  };
}
