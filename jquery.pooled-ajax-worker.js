/**
 * Pooled Worker
 *
 * Ce plugin permet de mutualiser des workers entre plusieurs onglets
 * d'un même domaine.
 *
 * Le premier worker à démarrer prend le rôle de maitre, c'est lui qui
 * executera les requetes et qui transmettra leurs réponses aux autres
 * workers.
 *
 * Les workers qui démarrent après le worker maitre prennent le rôle
 * d'esclaves, ils attendent les reponses des requetes transmises par le
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
    $.PooledWorker = function(id, settings) {
        this.id = id;
        this.settings = $.extend(true, this.defaultSettings, settings);

        // Flag that tell if the worker is working
        this.is_working = false;

        // Flag that tell if we are the master worker
        this.is_master = false;

        // Shortcut for storage handler
        this.storage = this.settings.storage.handler;

        // The worker timer
        this.worker_timer = null;

        // Destroy the lock on page quit (if we are the master)
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
    $.PooledWorker.prototype.locked = function() {
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
    $.PooledWorker.prototype.lock = function(duration) {
        var time = new Date().getTime();
        this.storage.setItem(this.settings.storage.lockKey, time + duration);
        // Now we are the master
        this.is_master = true;
    };

    /**
     * Unlock
     */
    $.PooledWorker.prototype.unlock = function() {
        this.storage.setItem(this.settings.storage.lockKey, null);
        // We are no more the master
        this.is_master = false;
    };

    /**
     * Start the listener and trigger callback upon new data
     *
     * @param callback
     */
    $.PooledWorker.prototype.startListener = function(callback) {
        $(window).on('storage', {
            callback: callback,
            responseKey: this.settings.storage.responseKey
        }, this.listenReceive);
    };

    /**
     * Stop the listener
     *
     * @param callback
     */
    $.PooledWorker.prototype.stopListener = function(callback) {
        $(window).off('storage', this.listenReceive);
    };

    /**
     * Listener receive event handler
     *
     * @param event
     */
    $.PooledWorker.prototype.listenReceive = function(event) {
        var params = event.data || event.originalEvent.data || {};
        var key = event.key || event.originalEvent.key;
        var value = event.newValue || event.originalEvent.newValue;
        // Check if the key match the responseKey
        if (key == params.responseKey) {
            // Execute the callback
            if (typeof params.callback == 'function') {
                params.callback.apply(event, [value]);
            }
        }
    };

    /**
     * Propagate data to slaves
     *
     * @param data
     */
    $.PooledWorker.prototype.propagateData = function(data) {
        this.storage.setItem(this.settings.storage.responseKey, data);
    };


    /**
     * Start the worker and trigger the callback upon new data
     *
     * @param callback
     */
    $.PooledWorker.prototype.startWorker = function(callback) {
        var self = this;

        self.is_working = true;

        // Launch the worker
        self.triggerWorker()
            // When the worker has succeeded a query
            .done(function(data) {
                // Triggers the callback
                if (typeof callback == 'function') {
                    callback.apply(event, [data]);
                }
            })
            // When the worker has finished
            .always(function() {
                if (self.is_working) {
                    // Triggers the worker again with a delay
                    self.worker_timer = setTimeout(function() {
                        self.startWorker(callback);
                    }, self.settings.delay);
                    // Lock during the delayed execution if we are the master worker
                    if (self.is_master) {
                        self.lock(self.settings.delay);
                    }
                }
            })
        ;
    };

    /**
     * Triggers the worker and return a promise
     *
     * @returns {*}
     */
    $.PooledWorker.prototype.triggerWorker = function() {
        var self = this;

        // Create a new deferred response
        var response = $.Deferred();

        // Locked
        if (self.locked()) {
            // Reject the response's promise 
            response.rejectWith(self);
        }

        // Not locked
        else {
            // Execute the query
            self.settings.query.handler()
                // Query succeeded
                .done(function(data) {
                    // Propagate data
                    self.propagateData(data);
                    // Resolve the response's promise
                    response.resolveWith(self);
                })
                // Query failed
                .fail(function(error) {
                    // Reject the response's promise
                    response.rejectWith(self);
                })
            ;
        }

        return response.promise();
    };

    /**
     * Stop the worker
     */
    $.PooledWorker.prototype.stopWorker = function() {
        // Stop delayed worker
        if (this.worker_timer) {
            clearTimeout(this.worker_timer);
        }
        // Unlock if we are the master
        if (this.is_master) {
            this.unlock();
        }
        this.is_working = false;
    };

    /**
     * Start the worker + the listener and trigger callback upon new data
     */
    $.PooledWorker.prototype.start = function(callback) {
        this.startWorker(callback);
        this.startListener(callback);
    };

    /**
     * Stop tje worker + the listener
     */
    $.PooledWorker.prototype.stop = function() {
        this.stopWorker();
        this.stopListener();
    };

    /**
     * Get settings
     *
     * @returns {*}
     */
    $.PooledWorker.prototype.getSettings = function() {
        return this.settings;
    };

    /**
     * Set settings
     *
     * @param settings
     * @returns {*}
     */
    $.PooledWorker.prototype.setSettings = function(settings) {
        return this.settings = $.extend(true, this.settings, settings);
    };

    /**
     * Cookie Storage (fallback for localStorage)
     *
     * @type {{setItem: setItem, getItem: getItem}}
     */
    $.PooledWorker.prototype.cookieStorage = {

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
    $.PooledWorker.prototype.defaultSettings = {

        // Delay between each worker execution
        delay: 3000,

        // Storage settings
        storage: {
            responseKey: 'pooled-worker-response',
            lockKey: 'pooled-worker-lock',
            handler: window.localStorage ? window.localStorage : $.pooledWorker.cookieStorage
        },

        // Query settings
        query: {
            handler: function() {
                // Lock during the ajax query (using ajax timeout as duration)
                this.lock(this.settings.query.ajax.timeout);
                // Execute the ajax query and return the promise
                return $.ajax(this.settings.query.ajax);
            },
            ajax: {
                timeout: 10000
            }
        }
    };

})(jQuery);

/**
 * Usage examples
 */
(function($) {

    // Create a new worker
    var $worker = new $.PooledWorker('chat-worker', {
        query: {
            ajax: {
                url: '/echo/html/',
                type: 'POST',
                data: {
                    html: "test",
                    delay: 3
                }
            }
        }
    });

    // Start/stop the worker/listener
    $worker.start(function(response) {
        console.log('data :', data);
    });
    $worker.stop();

    // Start/stop the worker
    $worker.startWorker(function(data) {
        console.log('data from worker :', data);
    });
    $worker.stopWorker();

    // Start/stop the listener
    $worker.startListener(function(data) {
        console.log('data from propagation :', data);
    });
    $worker.stopListener();

})(jQuery);
