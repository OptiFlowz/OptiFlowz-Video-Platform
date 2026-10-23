import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// Each platform defines its own editor palette for its surface brightness.
export const codeHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.tagName, tags.typeName], color: 'var(--codeTag)' },
  { tag: tags.className, color: 'var(--codeSelector)' },
  { tag: tags.variableName, color: 'var(--codeVariable)' },
  { tag: tags.propertyName, color: 'var(--codeProperty)' },
  { tag: tags.attributeName, color: 'var(--codeAttribute)' },
  { tag: [tags.string, tags.attributeValue, tags.special(tags.string)], color: 'var(--codeString)' },
  { tag: [tags.number, tags.color, tags.unit, tags.bool, tags.null], color: 'var(--codeNumber)' },
  { tag: [tags.keyword, tags.modifier, tags.meta], color: 'var(--codeKeyword)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--codeFunction)' },
  { tag: [tags.punctuation, tags.operator], color: 'var(--codePunctuation)' },
  { tag: tags.comment, color: 'var(--codeComment)', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'var(--codeInvalid)', textDecoration: 'underline wavy' },
]));
