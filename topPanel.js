
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Clutter = imports.gi.Clutter;

const Main = imports.ui.main;
const Layout = imports.ui.layout;
const Tweener = imports.ui.tweener;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Intellihide = Me.imports.intellihide;
const DEBUG = Convenience.DEBUG;

const PANEL_BOX = Main.panel.actor.get_parent();
const ShellActionMode = (Shell.ActionMode)?Shell.ActionMode:Shell.KeyBindingMode;

const topPanel = new Lang.Class({
    Name: 'topPanel',

    _init: function(settings) {
        this._panelHeight = Main.panel.actor.get_height();
        this._preventHide = false;
        this._intellihideBlock = false;
        this._staticBox = new Clutter.ActorBox();
        this._tweenActive = false;

        Main.layoutManager.removeChrome(PANEL_BOX);
        Main.layoutManager.addChrome(PANEL_BOX, {
            affectsStruts: false,
            trackFullscreen: true
        });

        // Load settings
        this._settings = settings;
        this._bindSettingsChanges();
        this._updateSettingsMouseSensitive();

        this._intellihide = new Intellihide.intellihide(this._settings);

        this._signalsHandler = new Convenience.GlobalSignalsHandler();
        this._signalsHandler.add(
            [
                Main.overview,
                'showing',
                Lang.bind(this, function() {
                    this.show(
                        this._settings.get_double('animation-time-overview'),
                        "showing-overview"
                    );
                })
            ],
            [
                Main.overview,
                'hiding',
                Lang.bind(this, function() {
                    this.hide(
                        this._settings.get_double('animation-time-overview'),
                        "hiding-overview"
                    );
                })
            ],
            [
                Main.panel.actor,
                'leave-event',
                Lang.bind(this, this._handleMenus)
            ],
            [
                global.screen,
                'monitors-changed',
                Lang.bind(this, this._updateStaticBox)
            ],
            [
                this._intellihide,
                'status-changed',
                Lang.bind(this, this._updatePreventHide)
            ]
        );

        this._updateStaticBox();
        Mainloop.timeout_add(100,
            Lang.bind(this, this._updateIntellihideStatus)
        );

        this._shortcutTimeout = 0;
        Main.wm.addKeybinding("shortcut-keybind",
            this._settings, Meta.KeyBindingFlags.NONE,
            ShellActionMode.NORMAL,
            Lang.bind(this, this._handleShortcut)
        );
    },

    hide: function(animationTime, trigger) {
        DEBUG("hide(" + trigger + ")");
        if(this._preventHide || PANEL_BOX.height <= 1) return;

        this._panelHeight = Main.panel.actor.get_height();

        if(trigger == "mouse-left"
           && global.get_pointer()[1] < this._staticBox.y1 + this._panelHeight) {
            return;
        }

        if(this._tweenActive) {
            Tweener.removeTweens(PANEL_BOX, "y");
            this._tweenActive = false;
        }

        let x = Number(this._settings.get_boolean('hot-corner'));
        PANEL_BOX.height = x;

        this._tweenActive = true;
        Tweener.addTween(PANEL_BOX, {
            y: this._staticBox.y1 + x - this._panelHeight,
            time: animationTime,
            transition: 'easeOutQuad',
            onComplete: Lang.bind(this, function() {
                this._tweenActive = false;
                Main.panel.actor.set_opacity(0);
            })
        });
    },

    show: function(animationTime, trigger) {
        DEBUG("show(" + trigger + ")");
        if(trigger == "mouse-enter"
           && this._settings.get_boolean('mouse-triggers-overview')) {
            Main.overview.show();
        }

        if(this._tweenActive) {
            Tweener.removeTweens(PANEL_BOX, "y");
            this._tweenActive = false;
        }

        PANEL_BOX.height = this._panelHeight;
        Main.panel.actor.set_opacity(255);

        if(trigger == "destroy"
           || (
               trigger == "showing-overview"
               && global.get_pointer()[1] < this._panelHeight
               && this._settings.get_boolean('hot-corner')
              )
          ) {
            PANEL_BOX.y = this._staticBox.y1;
        } else {
            this._tweenActive = true;
            Tweener.addTween(PANEL_BOX, {
                y: this._staticBox.y1,
                time: animationTime,
                transition: 'easeOutQuad',
                onComplete: Lang.bind(this, function() {
                    this._tweenActive = false;
                    this._updateStaticBox();
                })
            });
        }
    },

    _handleMenus: function() {
        if(!Main.overview.visible) {
            let blocker = Main.panel.menuManager.activeMenu;
            if(blocker == null) {
                this.hide(
                    this._settings.get_double('animation-time-autohide'),
                    "mouse-left"
                );
            } else {
                this._blockerMenu = blocker;
                this._menuEvent = this._blockerMenu.connect(
                    'open-state-changed',
                    Lang.bind(this, function(menu, open) {
                        if(!open && this._blockerMenu !== null) {
                            this._blockerMenu.disconnect(this._menuEvent);
                            this._menuEvent=null;
                            this._blockerMenu=null;
                            this._handleMenus();
                        }
                    })
                );
            }
        }
    },
    
    _handleShortcut: function () {
        var delay_time = this._settings.get_double('shortcut-delay');
        if(this._shortcutTimeout && (delay_time < 0.05
           || this._settings.get_boolean('shortcut-toggles'))) {
            Mainloop.source_remove(this._shortcutTimeout);
            this._shortcutTimeout = null;
            this._intellihideBlock = false;
            this._preventHide = false;
            this.hide(
                this._settings.get_double('animation-time-autohide'),
                "shortcut"
            );
        } else {
            this._intellihideBlock = true;
            this._preventHide = true;
            
            if(delay_time > 0.05) {
                this.show(delay_time/5.0, "shortcut");
                
                this._shortcutTimeout = Mainloop.timeout_add(
                    delay_time*1200,
                    Lang.bind(this, function () {
                        this._preventHide = false;
                        this._intellihideBlock = false;
                        this._handleMenus();
                        this._shortcutTimeout = null;
                        return false;
                    })
                );
            } else {
                this.show(
                    this._settings.get_double('animation-time-autohide'),
                    "shortcut"
                );
                this._shortcutTimeout = true;
            }
        }
    },

    _disablePressureBarrier: function() {
        if(this._panelBarrier && this._panelPressure) {
            this._panelPressure.removeBarrier(this._panelBarrier);
            this._panelBarrier.destroy();
        }
    },

    _initPressureBarrier: function() {
        this._panelPressure = new Layout.PressureBarrier(
            this._settings.get_int('pressure-threshold'),
            this._settings.get_int('pressure-timeout'), 
            ShellActionMode.NORMAL
        );
        this._panelPressure.setEventFilter(function(event) {
            if (event.grabbed && Main.modalCount == 0)
                return true;
            return false;
        });
        this._panelPressure.connect(
            'trigger',
            Lang.bind(this, function(barrier) {
                if (Main.layoutManager.primaryMonitor.inFullscreen)
                    return;
                this.show(
                    this._settings.get_double('animation-time-autohide'),
                    "mouse-enter"
                );
            })
        );
        let monitor = Main.layoutManager.primaryMonitor;
        this._panelBarrier = new Meta.Barrier({
            display: global.display,
            x1: monitor.x,
            x2: monitor.x + monitor.width,
            y1: monitor.y,
            y2: monitor.y,
            directions: Meta.BarrierDirection.POSITIVE_Y
        });
        this._panelPressure.addBarrier(this._panelBarrier);
    },

    _updateStaticBox: function() {
        DEBUG("_updateStaticBox()");
        this._staticBox.init_rect(
            PANEL_BOX.x, PANEL_BOX.y, PANEL_BOX.width, PANEL_BOX.height
        );
        this._intellihide.updateTargetBox(this._staticBox);
    },

    _updateSettingsHotCorner: function() {
        this.hide(0.1, "hot-corner-setting-changed");
    },

    _updateSettingsMouseSensitive: function() {
        if(this._settings.get_boolean('mouse-sensitive')) {
            this._disablePressureBarrier();
            this._initPressureBarrier();
        } else this._disablePressureBarrier();
    },

    _updateIntellihideStatus: function() {
        if(this._settings.get_boolean('enable-intellihide'))
            this._intellihide.enable();
        else {
            this._intellihide.disable();
            this.hide(0, "init");
        }

        this._intellihide._onlyActive(this._settings.get_boolean('enable-active-window'));
    },

    _updatePreventHide: function() {
        if(this._intellihideBlock) return;

        this._preventHide = !this._intellihide.getOverlapStatus();
        let animTime = this._settings.get_double('animation-time-autohide');
        if(this._preventHide)
            this.show(animTime, "intellihide");
        else if(!Main.overview.visible)
            this.hide(animTime, "intellihide");
    },

    _bindSettingsChanges: function() {
        this._signalsHandler = new Convenience.GlobalSignalsHandler();
        this._signalsHandler.addWithLabel("settings",
            [
                this._settings,
                'changed::hot-corner',
                Lang.bind(this, this._updateSettingsHotCorner)
            ],
            [
                this._settings,
                'changed::mouse-sensitive',
                Lang.bind(this, this._updateSettingsMouseSensitive)
            ],
            [
                this._settings,
                'changed::pressure-timeout',
                Lang.bind(this, this._updateSettingsMouseSensitive)
            ],
            [
                this._settings,
                'changed::pressure-threshold',
                Lang.bind(this, this._updateSettingsMouseSensitive)
            ],
            [
                this._settings,
                'changed::enable-intellihide',
                Lang.bind(this, this._updateIntellihideStatus)
            ],
            [
                this._settings,
                'changed::enable-active-window',
                Lang.bind(this, this._updateIntellihideStatus)
            ]
        );
    },

    destroy: function() {
        this._intellihide.destroy();
        this._signalsHandler.destroy();
        Main.wm.removeKeybinding("shortcut-keybind");
        this._disablePressureBarrier();

        this.show(0, "destroy");

        Main.layoutManager.removeChrome(PANEL_BOX);
        Main.layoutManager.addChrome(PANEL_BOX, {
            affectsStruts: true,
            trackFullscreen: true
        });
    }
});
