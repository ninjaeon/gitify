import path from 'node:path';

import {
  app,
  type BrowserWindowConstructorOptions,
  globalShortcut,
  safeStorage,
  shell,
} from 'electron';
import log from 'electron-log';
import { menubar } from 'menubar';

import { APPLICATION } from '../shared/constants';
import {
  EVENTS,
  type IAutoLaunch,
  type IKeyboardShortcut,
  type IOpenExternal,
} from '../shared/events';
import { logInfo, logWarn } from '../shared/logger';
import { isLinux, isWindows } from '../shared/platform';

import { handleMainEvent, onMainEvent, sendRendererEvent } from './events';
import { onFirstRunMaybe } from './first-run';
import { TrayIcons } from './icons';
import MenuBuilder from './menu';
import AppUpdater from './updater';

log.initialize();

/**
 * File paths
 */
const preloadFilePath = path.join(__dirname, 'preload.js');
const indexHtmlFilePath = `file://${__dirname}/index.html`;
const notificationSoundFilePath = path.join(
  __dirname,
  '..',
  'assets',
  'sounds',
  APPLICATION.NOTIFICATION_SOUND,
);
const twemojiDirPath = path.join(__dirname, 'images', 'twemoji');

const browserWindowOpts: BrowserWindowConstructorOptions = {
  width: 500,
  height: 400,
  minWidth: 500,
  minHeight: 400,
  resizable: false,
  skipTaskbar: true, // Hide the app from the Windows taskbar
  webPreferences: {
    preload: preloadFilePath,
    contextIsolation: true,
    nodeIntegration: false,
  },
};

const mb = menubar({
  icon: TrayIcons.idle,
  index: indexHtmlFilePath,
  browserWindow: browserWindowOpts,
  preloadWindow: true,
  showDockIcon: false, // Hide the app from the macOS dock
});

// Additional Menubar and BrowserWindow event listeners for logging
mb.on('after-create-window', () => {
  logInfo(
    'MenubarEvent',
    '"after-create-window" fired. Window initial visibility: ' +
      (mb.window ? mb.window.isVisible() : 'N/A'),
  );
  if (mb.window) {
    logInfo(
      'MenubarEvent',
      'Attaching BrowserWindow specific event listeners.',
    );
    mb.window.on('show', () => {
      logInfo(
        'BrowserWindowEvent',
        '(mb.window) "show". Current visibility: ' +
          (mb.window ? mb.window.isVisible() : 'N/A'),
      );
    });
    mb.window.on('hide', () => {
      logInfo(
        'BrowserWindowEvent',
        '(mb.window) "hide". Current visibility: ' +
          (mb.window ? mb.window.isVisible() : 'N/A'),
      );
    });
    mb.window.on('focus', () => {
      logInfo('BrowserWindowEvent', '(mb.window) "focus".');
    });
    mb.window.on('blur', () => {
      logInfo('BrowserWindowEvent', '(mb.window) "blur".');
    });
  } else {
    logWarn(
      'MenubarEvent',
      '"after-create-window" fired, but mb.window is not available to attach listeners.',
    );
  }
});

mb.on('show', () => {
  logInfo(
    'MenubarEvent',
    '"show" (before window.show()). Window visibility before internal show: ' +
      (mb.window ? mb.window.isVisible() : 'N/A'),
  );
});

mb.on('after-show', () => {
  logInfo(
    'MenubarEvent',
    '"after-show". Window visibility after internal show: ' +
      (mb.window ? mb.window.isVisible() : 'N/A'),
  );
});

mb.on('hide', () => {
  logInfo(
    'MenubarEvent',
    '"hide" (before window.hide()). Window visibility before internal hide: ' +
      (mb.window ? mb.window.isVisible() : 'N/A'),
  );
});

mb.on('after-hide', () => {
  logInfo(
    'MenubarEvent',
    '"after-hide". Window visibility after internal hide: ' +
      (mb.window ? mb.window.isVisible() : 'N/A'),
  );
});

const menuBuilder = new MenuBuilder(mb);
const contextMenu = menuBuilder.buildMenu();

// Register your app as the handler for a custom protocol
const protocol =
  process.env.NODE_ENV === 'development' ? 'gitify-dev' : 'gitify';
app.setAsDefaultProtocolClient(protocol);

const appUpdater = new AppUpdater(mb, menuBuilder);

let shouldUseAlternateIdleIcon = false;
let isOAuthLaunch = false;
let shouldUseUnreadActiveIcon = true;

app.whenReady().then(async () => {
  await onFirstRunMaybe();

  appUpdater.start();

  mb.on('ready', () => {
    logInfo('MenubarEvent', '"ready" fired.');
    let initialStartupDecisionMade = false;

    ipc.on(
      namespacedEvent('should-show-window-on-startup'),
      (_event, showWindowOnStartupBoolean) => {
        logInfo(
          'main:ipc:startupShow',
          `Received event. Value: ${showWindowOnStartupBoolean}, initialStartupDecisionMade: ${initialStartupDecisionMade}, isOAuthLaunch: ${isOAuthLaunch}, mb.window visible: ${mb.window?.isVisible() ?? 'N/A'}`,
        );

        if (initialStartupDecisionMade) {
          logInfo(
            'main:ipc:startupShow',
            'Startup decision already processed or OAuth launch took precedence. Ignoring event.',
          );
          return;
        }

        if (isOAuthLaunch) {
          logInfo(
            'main:ipc:startupShow',
            'OAuth launch detected. Visibility managed by handleURL.',
          );
          initialStartupDecisionMade = true; // Mark that startup visibility decision is "handled" by OAuth
          return;
        }

        initialStartupDecisionMade = true;
        const preActionIsVisible = mb.window ? mb.window.isVisible() : 'N/A';

        logInfo(
          'main:ipc:startupShow',
          `Normal Startup: Processing setting: ${showWindowOnStartupBoolean}. Window current visibility (pre-action): ${preActionIsVisible}`,
        );

        if (showWindowOnStartupBoolean) {
          if (!mb.window?.isVisible()) { // Re-check, though preActionIsVisible is a good indicator
            logInfo(
              'main:ipc:startupShow',
              'Normal Startup: Setting is TRUE. Window not visible. Calling mb.showWindow().',
            );
            mb.showWindow();
            logInfo(
              'main:ipc:startupShow',
              `Called mb.showWindow(). Window now visible: ${mb.window ? mb.window.isVisible() : 'N/A'}`,
            );
          } else {
            logInfo(
              'main:ipc:startupShow',
              'Normal Startup: Setting is TRUE, window already visible. No action.',
            );
          }
        } else {
          // Normal Startup & showWindowOnStartupBoolean is FALSE
          logInfo(
            'main:ipc:startupShow',
            `Normal Startup: Setting is FALSE. Initial window visibility: ${preActionIsVisible}.`,
          );

          // Attempt to hide immediately if it became visible before this exact moment
          if (mb.window && mb.window.isVisible()) {
            logInfo(
              'main:ipc:startupShow',
              'Normal Startup: Setting is FALSE. Window is unexpectedly visible, hiding immediately.',
            );
            mb.hideWindow();
            logInfo(
              'main:ipc:startupShow',
              `Called immediate mb.hideWindow(). Window now visible: ${mb.window ? mb.window.isVisible() : 'N/A'}`,
            );
          } else {
            logInfo(
              'main:ipc:startupShow',
              'Normal Startup: Setting is FALSE. Window is already hidden or N/A. No immediate hide action.',
            );
          }

          // Set a timeout to re-check and hide if it was shown by a rogue event
          setTimeout(() => {
            // Re-check conditions: setting is still false, not an OAuth launch, and window exists
            if (!showWindowOnStartupBoolean && mb.window && !isOAuthLaunch) {
              if (mb.window.isVisible()) {
                logInfo(
                  'main:ipc:startupShow:delayedHide',
                  `Setting is FALSE. Window found visible after delay. Hiding again. isOAuthLaunch: ${isOAuthLaunch}`,
                );
                mb.hideWindow();
                logInfo(
                  'main:ipc:startupShow:delayedHide',
                  `Called delayed mb.hideWindow(). Window now visible: ${mb.window.isVisible()}`,
                );
              } else {
                logInfo(
                  'main:ipc:startupShow:delayedHide',
                  'Setting is FALSE. Window already hidden after delay. No action.',
                );
              }
            } else {
              logInfo(
                'main:ipc:startupShow:delayedHide',
                `Not hiding: showSettingTrue: ${showWindowOnStartupBoolean}, noWindow: ${!mb.window}, oAuth: ${isOAuthLaunch}`,
              );
            }
          }, 300); // 300ms delay
        }
      },
    );

    mb.app.setAppUserModelId(APPLICATION.ID);

    // Tray configuration
    mb.tray.setToolTip(APPLICATION.NAME);
    mb.tray.setIgnoreDoubleClickEvents(true);
    mb.tray.on('right-click', (_event, bounds) => {
      mb.tray.popUpContextMenu(contextMenu, { x: bounds.x, y: bounds.y });
    });

    // Custom key events
    mb.window.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Escape') {
        mb.window.hide();
        event.preventDefault();
      }
    });

    // DevTools configuration
    mb.window.webContents.on('devtools-opened', () => {
      mb.window.setSize(800, 600);
      mb.window.center();
      mb.window.resizable = true;
      mb.window.setAlwaysOnTop(true);
    });

    mb.window.webContents.on('devtools-closed', () => {
      const trayBounds = mb.tray.getBounds();
      mb.window.setSize(browserWindowOpts.width, browserWindowOpts.height);
      mb.positioner.move('trayCenter', trayBounds);
      mb.window.resizable = false;
    });
  });

  /** Prevent second instances */
  if (isWindows() || isLinux()) {
    const gotTheLock = app.requestSingleInstanceLock();

    if (!gotTheLock) {
      logWarn('main:gotTheLock', 'Second instance detected, quitting');
      app.quit(); // Quit the second instance
      return;
    }

    app.on('second-instance', (_event, commandLine, _workingDirectory) => {
      logInfo(
        'main:second-instance',
        'Second instance was launched.  extracting command to forward',
      );

      // Get the URL from the command line arguments
      const url = commandLine.find((arg) => arg.startsWith(`${protocol}://`));

      if (url) {
        handleURL(url);
      }
    });
  }

  /**
   * Gitify custom IPC events - no response expected
   */
  onMainEvent(EVENTS.WINDOW_SHOW, () => mb.showWindow());

  onMainEvent(EVENTS.WINDOW_HIDE, () => mb.hideWindow());

  onMainEvent(EVENTS.QUIT, () => mb.app.quit());

  onMainEvent(EVENTS.OPEN_EXTERNAL, (_, { url, activate }: IOpenExternal) =>
    shell.openExternal(url, { activate: activate }),
  );

  onMainEvent(
    EVENTS.USE_ALTERNATE_IDLE_ICON,
    (_, useAlternateIdleIcon: boolean) => {
      shouldUseAlternateIdleIcon = useAlternateIdleIcon;
    },
  );

  onMainEvent(
    EVENTS.USE_UNREAD_ACTIVE_ICON,
    (_, useUnreadActiveIcon: boolean) => {
      shouldUseUnreadActiveIcon = useUnreadActiveIcon;
    },
  );

  onMainEvent(EVENTS.UPDATE_ICON_COLOR, (_, notificationsCount: number) => {
    if (!mb.tray.isDestroyed()) {
      if (notificationsCount < 0) {
        setErrorIcon();
        return;
      }

      if (notificationsCount > 0) {
        setActiveIcon();
        return;
      }

      setIdleIcon();
    }
  });

  onMainEvent(EVENTS.UPDATE_ICON_TITLE, (_, title: string) => {
    if (!mb.tray.isDestroyed()) {
      mb.tray.setTitle(title);
    }
  });

  onMainEvent(
    EVENTS.UPDATE_KEYBOARD_SHORTCUT,
    (_, { enabled, keyboardShortcut }: IKeyboardShortcut) => {
      if (!enabled) {
        globalShortcut.unregister(keyboardShortcut);
        return;
      }

      globalShortcut.register(keyboardShortcut, () => {
        if (mb.window.isVisible()) {
          mb.hideWindow();
        } else {
          mb.showWindow();
        }
      });
    },
  );

  onMainEvent(EVENTS.UPDATE_AUTO_LAUNCH, (_, settings: IAutoLaunch) => {
    app.setLoginItemSettings(settings);
  });

  /**
   * Gitify custom IPC events - response expected
   */

  handleMainEvent(EVENTS.VERSION, () => app.getVersion());

  handleMainEvent(EVENTS.NOTIFICATION_SOUND_PATH, () => {
    return notificationSoundFilePath;
  });

  handleMainEvent(EVENTS.TWEMOJI_DIRECTORY, () => {
    return twemojiDirPath;
  });

  handleMainEvent(EVENTS.SAFE_STORAGE_ENCRYPT, (_, value: string) => {
    return safeStorage.encryptString(value).toString('base64');
  });

  handleMainEvent(EVENTS.SAFE_STORAGE_DECRYPT, (_, value: string) => {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  });
});

// Handle gitify:// custom protocol URL events for OAuth 2.0 callback
app.on('open-url', (event, url) => {
  event.preventDefault();
  logInfo('main:open-url', `URL received ${url}`);
  handleURL(url);
});

const handleURL = (url: string) => {
  if (url.startsWith(`${protocol}://`)) {
    isOAuthLaunch = true;
    logInfo('main:handleUrl', `forwarding URL ${url} to renderer process`);
<<<<<<< HEAD
    mb.window.webContents.send(namespacedEvent('auth-callback'), url);

    logInfo(
      'main:handleURL',
      `OAuth redirect: Current window visibility: ${mb.window?.isVisible() ?? 'N/A'}. Calling mb.showWindow().`,
    );
    mb.showWindow();
    logInfo('main:handleURL', 'OAuth redirect: Called mb.showWindow().');
=======
    sendRendererEvent(mb, EVENTS.AUTH_CALLBACK, url);
>>>>>>> upstream/main
  }
};

function setIdleIcon() {
  if (shouldUseAlternateIdleIcon) {
    mb.tray.setImage(
      menuBuilder.isUpdateAvailable()
        ? TrayIcons.idleAlternateWithUpdate
        : TrayIcons.idleAlternate,
    );
  } else {
    mb.tray.setImage(
      menuBuilder.isUpdateAvailable()
        ? TrayIcons.idleWithUpdate
        : TrayIcons.idle,
    );
  }
}

function setActiveIcon() {
  if (shouldUseUnreadActiveIcon) {
    mb.tray.setImage(
      menuBuilder.isUpdateAvailable()
        ? TrayIcons.activeWithUpdate
        : TrayIcons.active,
    );
  } else {
    setIdleIcon();
  }
}

function setErrorIcon() {
  mb.tray.setImage(TrayIcons.error);
}
