import { useCallback, useEffect, useRef, useState } from 'react';
import { Annotation, Compartment, EditorState, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { codeHighlighting } from './syntax';
import ColorPicker from './ColorPicker';
import { colorTokens, resolveColor, serializeColor, type ColorToken, type RGBA } from './colors';
import styles from './editor.module.css';

const externalValue = Annotation.define<boolean>();

type Props = { value: string; onChange: (value: string) => void; label: string; disabled?: boolean; language?: 'html' | 'css' };
type Selection = ColorToken & { color: RGBA; anchor: DOMRect };
export default function CodeEditor({ value, onChange, label, disabled = false, language = 'css' }: Props) {
  const host = useRef<HTMLDivElement>(null), editor = useRef<EditorView | null>(null);
  const latest = useRef({ onChange, disabled, label }); latest.current = { onChange, disabled, label };
  const editable = useRef(new Compartment());
  const selection = useRef<Selection | null>(null), [picker, setPicker] = useState<Selection | null>(null);
  const pickerChange = useRef(false);
  const close = useCallback(() => { selection.current = null; setPicker(null); }, []);
  const dismiss = useCallback(() => { close(); editor.current?.focus(); }, [close]);
  useEffect(() => {
    class Swatch extends WidgetType {
      constructor(readonly color: string, readonly disabled: boolean) { super(); }
      eq(other: Swatch) { return other.color === this.color && other.disabled === this.disabled; }
      toDOM(view: EditorView) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = styles.swatch;
        button.style.setProperty('--swatch-color', this.color);
        button.setAttribute('aria-label', `${latest.current.label}: ${this.color}`);
        button.title = this.color; button.disabled = view.state.readOnly;
        button.onmousedown = event => event.preventDefault();
        button.onclick = event => {
          event.preventDefault(); event.stopPropagation();
          if (latest.current.disabled) return;
          const color = resolveColor(this.color); if (!color) return;
          const from = view.posAtDOM(button), next = { from, to: from + this.color.length, text: this.color, color, anchor: button.getBoundingClientRect() };
          selection.current = next; setPicker(next);
        };
        return button;
      }
      ignoreEvent() { return true; }
    }
    const decorate = (state: EditorState) => Decoration.set(colorTokens(state.doc.toString(), value => CSS.supports('color', value)).map(token => Decoration.widget({ widget: new Swatch(token.text, state.readOnly), side: -1 }).range(token.from)));
    const swatches = StateField.define({ create: decorate, update: (current, transaction) => transaction.docChanged || transaction.reconfigured ? decorate(transaction.state) : current, provide: field => EditorView.decorations.from(field) });
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions: [
      language === 'html' ? html({ autoCloseTags: false }) : [css(), swatches],
      codeHighlighting, history(), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      editable.current.of([EditorState.readOnly.of(latest.current.disabled), EditorView.editable.of(!latest.current.disabled)]),
      EditorView.contentAttributes.of({ 'aria-label': latest.current.label, 'aria-multiline': 'true', spellcheck: 'false' }),
      lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), EditorView.lineWrapping,
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        if (!pickerChange.current) close();
        if (update.transactions.every(transaction => transaction.annotation(externalValue))) return;
        latest.current.onChange(update.state.doc.toString());
      }),
    ] }) });
    editor.current = view;
    return () => { view.destroy(); editor.current = null; };
    // External values and read-only mode are synchronized without rebuilding undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close, language]);
  useEffect(() => {
    const view = editor.current;
    // CodeMirror stores normalized line endings. Compare documents, not the
    // raw server string, and never report controlled-value sync as a user edit.
    if (view && !view.state.toText(value).eq(view.state.doc)) view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: [externalValue.of(true), Transaction.addToHistory.of(false)],
    });
  }, [value]);
  useEffect(() => {
    editor.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]) });
    if (disabled) close();
  }, [disabled, close]);
  const changeColor = (color: RGBA) => {
    const view = editor.current, active = selection.current;
    if (!view || !active || latest.current.disabled || view.state.sliceDoc(active.from, active.to) !== active.text) { close(); return; }
    const text = serializeColor(color, picker!.text);
    pickerChange.current = true;
    try { view.dispatch({ changes: { from: active.from, to: active.to, insert: text }, userEvent: 'input.color' }); }
    finally { pickerChange.current = false; }
    selection.current = { ...active, text, to: active.from + text.length };
  };
  return <div className={styles.editor}>
    <div ref={host} />
    {picker && !disabled && <ColorPicker label={label} color={picker.color} anchor={picker.anchor} onChange={changeColor} onClose={dismiss} />}
  </div>;
}
