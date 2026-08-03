import { useState, useCallback } from 'react';

export interface AutocompleteSuggestion {
  id: string;
  text: string;
  type: 'folder' | 'note' | 'citation';
}

export function useAutocomplete() {
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const [autocompleteSuggestions, setAutocompleteSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [autocompleteSelectionIndex, setAutocompleteSelectionIndex] = useState(0);

  const cycleSuggestions = useCallback((direction: 'next' | 'prev') => {
    if (autocompleteSuggestions.length === 0) return;
    setAutocompleteSelectionIndex((prev) => {
      if (direction === 'next') {
        return prev < autocompleteSuggestions.length - 1 ? prev + 1 : 0;
      }
      return prev > 0 ? prev - 1 : autocompleteSuggestions.length - 1;
    });
  }, [autocompleteSuggestions]);

  return {
    autocompleteQuery,
    setAutocompleteQuery,
    autocompleteSuggestions,
    setAutocompleteSuggestions,
    isAutocompleteOpen,
    setIsAutocompleteOpen,
    autocompleteSelectionIndex,
    setAutocompleteSelectionIndex,
    cycleSuggestions
  };
}
