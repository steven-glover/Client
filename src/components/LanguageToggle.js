// src/components/LanguageToggle.jsx
import React from 'react';
import '../styles/LanguageToggle.css';

/**
 * Props
 * ─────────────────────────────────────────────
 * value        – current code: 'en' | 'ja'
 * onChange     – (newCode) => void
 * label        – optional heading (e.g. “Speak” or “Hear”)
 * idPrefix     – unique id prefix so <input>s don’t clash
 */
export default function LanguageToggle({ value, onChange, label, idPrefix }) {
  return (
    <div className='text-center'>
      {label && <span className="lang-toggle__label">{label}</span>}
        <div className="lang-toggle">

        {/** English */}
        <input
            type="radio"
            id={`${idPrefix}-en`}
            name={idPrefix}
            value="en"
            checked={value === 'en'}
            onChange={() => onChange('en')}
            className="lang-toggle__input"
        />
        <label htmlFor={`${idPrefix}-en`} className="lang-toggle__option">
            🇺🇸 <span>EN</span>
        </label>

        {/** Japanese */}
        <input
            type="radio"
            id={`${idPrefix}-ja`}
            name={idPrefix}
            value="ja"
            checked={value === 'ja'}
            onChange={() => onChange('ja')}
            className="lang-toggle__input"
        />
        <label htmlFor={`${idPrefix}-ja`} className="lang-toggle__option">
            🇯🇵 <span>JP</span>
        </label>

        <span className="lang-toggle__bg" data-active={value} />
        </div>
    </div>
  );
}
