import {useEffect, useRef, useState} from 'preact/hooks';
import {KEY} from '../config/constants';
import {t as tr} from '../lib/i18n';

interface Props {
	title: string;
	hint: string;
	initial: string;
	placeholder?: string;
	/** what is set now, shown under the field ("Now: Cathays, Cardiff") */
	current?: string;
	/** resolves to close the prompt; rejects with the message to show (the prompt stays open) */
	onSubmit: (text: string) => Promise<void>;
	onClear?: () => void;
	onClose: () => void;
}

const BUTTONS = ['Look up', 'Remove', 'Cancel'] as const;

/** A text field over Settings, typed with the TV's on-screen keyboard (webOS opens it when the field has focus; OK on the field opens it
 *  again). Down goes to the buttons, Up back to the field; OK / the keyboard's Enter looks the text up; Back cancels. It listens in the
 *  capture phase and stops every key it handles, so the Settings page under it (inactive anyway) never sees them. */
export function TextPrompt ({title, hint, initial, placeholder, current, onSubmit, onClear, onClose}: Props) {
	const input = useRef<HTMLInputElement>(null);
	const [focus, setFocus] = useState(-1);          // -1 the field, else a button
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const state = useRef({focus, busy});
	state.current = {focus, busy};

	const submit = () => {
		const el = input.current;
		if (!el || state.current.busy) return;
		setBusy(true); setError('');
		onSubmit(el.value).then(() => { setBusy(false); onClose(); }, (e: Error) => { setBusy(false); setError(e.message || 'Not found'); });
	};
	const press = (i: number) => {
		if (BUTTONS[i] === 'Look up') submit();
		else if (BUTTONS[i] === 'Remove') { if (onClear) onClear(); onClose(); }
		else onClose();
	};

	useEffect(() => { const el = input.current; if (el) { el.value = initial; el.focus(); } }, []);
	useEffect(() => {
		const el = input.current;
		if (!el) return;
		if (focus === -1) el.focus(); else el.blur();
	}, [focus]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const {focus: f} = state.current;
			const code = e.keyCode;
			let handled = true;
			if (code === KEY.back || code === KEY.escape) onClose();
			else if (code === KEY.enter) { if (f === -1) submit(); else press(f); }
			else if (f === -1) {
				if (code === KEY.down) setFocus(0);
				else handled = false;       // letters, Left / Right in the text, Backspace: the field's own
			} else if (code === KEY.up) setFocus(-1);
			else if (code === KEY.left) setFocus(Math.max(0, f - 1));
			else if (code === KEY.right) setFocus(Math.min(BUTTONS.length - 1, f + 1));
			else if (code !== KEY.down) handled = false;
			if (handled) { e.preventDefault(); e.stopPropagation(); }
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	}, []);

	return (
		<div class="prompt">
			<div class="prompt__panel">
				<h2 class="prompt__title">{tr(title)}</h2>
				<p class="prompt__hint">{hint}</p>
				<input ref={input} class={`prompt__input${focus === -1 ? ' prompt__input--focused' : ''}`} type="text" placeholder={placeholder} autocomplete="off" spellcheck={false}
					onFocus={() => setFocus(-1)} />
				<p class={`prompt__status${error ? ' prompt__status--error' : ''}`}>{busy ? tr('Looking up…') : error || (current ? `${tr('Now')}: ${current}` : '')}</p>
				<div class="prompt__buttons">
					{BUTTONS.map((b, i) => (
						<div key={b} class={`prompt__button${focus === i ? ' prompt__button--focused' : ''}`} onMouseEnter={() => setFocus(i)} onClick={() => press(i)}>{tr(b)}</div>
					))}
				</div>
			</div>
		</div>
	);
}
