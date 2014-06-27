/**
 * Pooled Ajax Worker
 * 
 * Ce plugin permet de mutualiser les workers Ajax entre plusieurs onglets
 * d'un même domaine
 * 
 * Le premier worker à démarrer prend le rôle de maitre, c'est lui qui
 * executera les requetes ajax et qui transmettra leurs réponses aux autres
 * workers.
 *
 * Les workers qui démarrent après le worker maitre prennent le rôle
 * d'esclaves, ils attendent les reponses des requetes ajax transmises par le
 * worker maitre.
 *
 * Quand un worker maitre s'arrête de fonctionner (arrêt via l'API, fermeture
 * de l'onglet, crash...) un worker esclave prend automatiquement sa place et
 * devient le nouveau worker maitre.
 *
 */
(function($) {

    /**
     * Constructor
     *
     * @param id
     * @param settings
     * @constructor
     */
    $.PooledAjaxWorker = function(id, settings) {
        this.id = id;
        this.settings = $.extend(true, this.defaultSettings, settings);
        
        // Flag that tell if we are the master worker
        this.is_master = false;
        
        // Shortcut for storage handler
        this.storage = this.settings.storage.handler;

        // The worker timer
        this.worker_timer = null;

        // Destroy the lock if we are the master
        var self = this;
        $(window).on('unload', function() {
            if (self.is_master) {
                self.storage.setItem(self.settings.storage.lockKey, null);
            }
        });
    };

    /**
     * Check if there is a lock
     *
     * @returns {boolean}
     */
    $.PooledAjaxWorker.prototype.locked = function() {
        // It is never locked when we are the master !
        if (this.is_master) {
            return false;
        }
        // Check in the storage if there is a lock
        var time = new Date().getTime();
        var lock = this.storage.getItem(this.settings.storage.lockKey);
        return (lock >= time);
    };

    /**
     * Lock
     *
     * @param duration
     */
    $.PooledAjaxWorker.prototype.lock = function(duration) {
        var time = new Date().getTime();
        this.storage.setItem(this.settings.storage.lockKey, time + duration);
        // Now we are the master
        this.is_master = true;
    };

    /**
     * Unlock
     */
    $.PooledAjaxWorker.prototype.unlock = function() {
        this.storage.setItem(this.settings.storage.lockKey, null);
        // We are no more the master
        this.is_master = false;
    };

    /**
     * Start the listener and trigger callback upon new data
     *
     * @param callback
     */
    $.PooledAjaxWorker.prototype.startListener = function(callback) {
        $(window).on('storage', {
            callback: callback,
            responseKey: this.settings.storage.responseKey
        }, this.listenEvent);
    };

    /**
     * Stop the listener
     *
     * @param callback
     */
    $.PooledAjaxWorker.prototype.stopListener = function(callback) {
        $(window).off('storage', this.listenEvent);
    };

    /**
     * Listen event
     *
     * @param event
     */
    $.PooledAjaxWorker.prototype.listenEvent = function(event) {
        var args = event.data || event.originalEvent.data || {};
        var key = event.key || event.originalEvent.key;
        // Check if the key match tje responseKey
        if (key == args.responseKey) {
            if (typeof args.callback == 'function') {
                // Execute the callback
                args.callback.apply(event, [
                    event.newValue || event.originalEvent.newValue
                ]);
            }
        }
    };

    $.PooledAjaxWorker.prototype.startWorker = function(callback) {
        //
        // Launch the worker
        this.launchWorker(callback);
    };

    /**
     * Start the worker and trigger callback upon new data
     *
     * @param callback
     */
    $.PooledAjaxWorker.prototype.launchWorker = function(callback) {
        var self = this;

        // Not locked
        if (!self.locked()) {

            // Lock during the ajax query (using ajax timeout as duration)
            self.lock(self.settings.ajax.timeout);

            // Execute the ajax query
            $.ajax($.extend(true, {}, self.settings.ajax, { data: { html: 'test '+(new Date().getTime()) }})) //@todo remove

                .done(function(response) {

                    // Execute the callback
                    callback.apply(event, [response]);

                    // Propagate the ajax response
                    this.storage.setItem(self.settings.storage.responseKey, response);
                })

                .always(function() {

                    // Lock during the delayed execution
                    self.lock(self.settings.ajax.timeout);

                    // Re-launch the worker with a delay
                    self.worker_timer = setTimeout(function() {
                        self.launchWorker(callback);
                    }, self.settings.interval);
                })
            ;
        }

        // Locked
        else {
            // Re-launch the worker with a delay
            self.worker_timer = setTimeout(function() {
                self.launchWorker(callback);
            }, self.settings.interval);
        }
    };

    /**
     * Stop the worker
     */
    $.PooledAjaxWorker.prototype.stopWorker = function() {
        // Stop the worker
        if (this.worker_timer) {
            clearTimeout(this.worker_timer);
        }
        // Unlock if we are the master
        if (this.is_master) {
            this.unlock();
        }
    };

    /**
     * Start the worker + the listener and trigger callback upon new data
     */
    $.PooledAjaxWorker.prototype.start = function(callback) {
        this.startWorker(callback);
        this.startListener(callback);
    };

    /**
     * Stop tje worker + the listener
     */
    $.PooledAjaxWorker.prototype.stop = function() {
        this.stopWorker();
        this.stopListener();
    };

    /**
     * Get settings
     *
     * @returns {*}
     */
    $.PooledAjaxWorker.prototype.getSettings = function() {
        return this.settings;
    };

    /**
     * Set settings
     *
     * @param settings
     * @returns {*}
     */
    $.PooledAjaxWorker.prototype.setSettings = function(settings) {
        return this.settings = $.extend(true, this.settings, settings);
    };

    /**
     * Cookie Storage (fallback for localStorage)
     *
     * @type {{setItem: setItem, getItem: getItem}}
     */
    $.PooledAjaxWorker.prototype.cookieStorage = {

        /**
         * Store a key with value
         *
         * @param key
         * @param value
         */
        setItem: function(key, value) {
            document.cookie = key + "=" + value +"; path=/";
        },

        /**
         * Get a stored value by key
         * @param key
         * @returns {*}
         */
        getItem: function(key) {
            var allCookies = document.cookie.split('; ');
            for (var i = 0 ; i < allCookies.length; i++) {
                var cookiePair = allCookies[i].split('=');
                if (cookiePair[0] == key) {
                    return cookiePair[1];
                }
            }
            return null;
        }
    };

    // Default settings
    /**
     * Set default settings
     */
    $.PooledAjaxWorker.prototype.defaultSettings = {

        // Interval between each worker execution
        interval: 3000,

        // Storage settings
        storage: {
            responseKey: 'ajax-pool-response',
            lockKey: 'ajax-pool-lock',
            handler: window.localStorage ? window.localStorage : $.pooledAjaxWorker.cookieStorage
        },

        // Ajax settings
        ajax: {
            timeout: 10000
        }
    };

})(jQuery);


(function($) {

    // 1. Create a new worker
    var $worker = new $.PooledAjaxWorker('chat-worker', {
        ajax: {
            url: '/echo/html/',
            type: 'POST',
            data: {
                html: "test",
                delay: 3
            }
        }
    });

    $worker.start();

    // 2. Start the worker
    $worker.startWorker(my_callback);

    // 3. Listen incoming data
    $worker.startListener(my_callback);

    // Stop the worker
    $worker.stopWorker();

    // Stop listening incoming data
    $worker.stopListener();

    function my_callback(response) {
        console.log('response !', response);
    }

})(jQuery);
