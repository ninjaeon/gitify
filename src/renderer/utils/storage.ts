<<<<<<< HEAD
import { Constants } from '../constants';
import type { GitifyState } from '../types';

export function loadState(): GitifyState {
  const existing = localStorage.getItem(Constants.STORAGE_KEY);
  const parsedState: Partial<GitifyState> = existing
    ? JSON.parse(existing)
    : {};

  const settings: Partial<SettingsState> = parsedState.settings || {};
  if (typeof settings.showWindowOnStartup === 'undefined') {
    settings.showWindowOnStartup = true; // Default to true
  }

  return {
    auth: parsedState.auth,
    settings: settings as SettingsState,
  };
}

export function saveState(gitifyState: GitifyState) {
  const auth = gitifyState.auth;
  const settings = gitifyState.settings;
  const settingsString = JSON.stringify({ auth, settings });
  localStorage.setItem(Constants.STORAGE_KEY, settingsString);
}

export function clearState() {
  localStorage.clear();
}
