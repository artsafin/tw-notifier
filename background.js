'use strict';

const RES = {
    ICON_48: "images/icon-48.png"
};

const defaultConfig = {
    lastTid: 0,
    pingMs: 4000,
    twHost: 'https://tw.fxtm.com',
    tracked: [],
    showPreviews: false,
};

const MODULE_TASKS_ID = 4;
const MODULE_SD_ID = 22;
const MODULE_BOARD_ID = 8;
const ALL_MODULES = [MODULE_TASKS_ID, MODULE_SD_ID, MODULE_BOARD_ID];

let forbiddenProbed = false;

chrome.runtime.onInstalled.addListener(({reason}) => {
    const addDefaultConfig = () => {
        chrome.storage.sync.set(defaultConfig, () => {
            chrome.storage.sync.get(null, (items) => {
                console.log('configured: ', items);
            });
        });
    };

    if (reason === 'update') {
        addDefaultConfig();
    } else {
        chrome.storage.sync.clear(() => {
            addDefaultConfig();
        });
    }
});

class Requests {
    constructor(twHost) {
        this.host = twHost;
    }

    request(method, url, params = '') {
        const xhr = new XMLHttpRequest();
        xhr.open(method, this.host + url, true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');

        return new Promise((resolve, reject) => {
            xhr.onreadystatechange = () => {
                if (xhr.readyState !== 4) {
                    return;
                }

                if (xhr.status !== 200) {
                    reject(xhr.status, xhr);
                } else {
                    let json;
                    try {
                        json = JSON.parse(xhr.responseText);
                    } catch (err) {
                    }

                    resolve({xhr, json});
                }
            };

            xhr.send(params);
        });
    }

    newEvents(tid) {
        return this
            .request('POST', '/server/history', 'tid=' + tid)
            .then(
                ({xhr, json}) => {
                    forbiddenProbed = false;

                    return json;
                },
                (status) => {
                    if (status !== 403 || forbiddenProbed) {
                        throw false;
                    }

                    forbiddenProbed = true;
                    throw true;
                });
    }

    lastComment(url) {
        const urlWithoutHash = /[^#]+/.exec(url)[0];

        return this
            .request('GET', urlWithoutHash + '?json=full')
            .then(
                ({xhr, json}) => {
                    this.makeUnread(url);

                    if (json && json.comments && Array.isArray(json.comments.comments)) {
                        return json.comments.comments[json.comments.comments.length - 1];
                    } else {
                        throw new Error('No comments object found: ' + JSON.stringify(json));
                    }
                }
            );
    }

    makeUnread(url) {
        if (url.match(/\/servicedesk\//)) {
            return this.request('POST', url.replace('view', 'make_unread'));
        }

        if (url.match(/\/tasks\//)) {
            const taskId = /\/view\/(\d+)/.exec(url)[1];

            return this.request('POST', '/tasks/operations/index', 'json=&make_unread=&id=' + taskId);
        }

        return Promise.reject(new Error('URL is not supported to mark unread: ' + url));
    }
}

class Notifications {
    /**
     * @param requests{Requests}
     * @param showPreviews{boolean}
     */
    constructor(requests, showPreviews) {
        this.requests = requests;
        this.showPreviews = showPreviews;
    }

    basic(item) {
        const opt = {
            type: "basic",
            title: item.data.title,
            message: '',
            iconUrl: RES.ICON_48
        };
        chrome.notifications.create(item.data.url, opt);
    };

    preview(item) {
        this.requests.lastComment(item.data.url)
            .then(
                (lastComment) => {
                    const opt = {
                        type: "basic",
                        title: item.data.title,
                        message: stripHtml(lastComment.text) || '',
                        iconUrl: lastComment.authorImage ? (this.requests.host + lastComment.authorImage) : RES.ICON_48
                    };
                    chrome.notifications.create(item.data.url, opt);
                },
                this.basic.bind(this, item)
            );
    };

    notifyAll(items) {
        const notifier = this.showPreviews ? this.preview.bind(this) : this.basic.bind(this);

        items
            .filter((item) => item && item.data)
            .forEach(notifier);
    };
}

const stripHtml = (html) => html
    .replace(/\r\n/gm, "\n")
    .replace(/\n/gm, " ")
    .replace(/\s{2,}/gm, ' ')
    .replace(/<table.*?<\/table>/gm, "(table)\n")
    .replace(/<\/(?:div|p)>/gm, "\n")
    .replace(/<(?:.|\n)*?>/gm, '')
    .replace(/&nbsp;/gm, ' ')
    .replace(/&amp;/gm, '&')
;

const filterHistory = (history, moduleIds, flags = null) =>
    history.filter((item) =>
        moduleIds.includes(item.module_id)
        && (flags === null || item.flags == flags)
    );

const filterTracked = (history, tracked) =>
    tracked.length ?
        history.filter((item) =>
            tracked.filter((trackItem) =>
                trackItem.record_id == item.record_id
                && trackItem.module_id == item.module_id
            ).length > 0
        )
        : history;

const updateUnreadCounter = (requests, tracked) =>
    requests
        .newEvents(0)
        .then(({history}) => setTotalItems(filterTracked(filterHistory(history, ALL_MODULES, 0), tracked).length))
;

const setTotalItems = (totalItems) => {
    const text = (totalItems === null) ? '' : '' + totalItems;

    chrome.browserAction.setBadgeText({text});

    return totalItems;
};

chrome.storage.sync.get(null, (initialConfig) => {
    let nextTid = initialConfig.lastTid;

    setInterval(() => {
        chrome.storage.sync.get(defaultConfig, ({tracked, twHost, showPreviews}) => {
            const requests = new Requests(twHost);
            const notifications = new Notifications(requests, showPreviews);

            requests.newEvents(nextTid)
                .then(
                    ({next_tid, history}) => {
                        const newCommentEvents = filterTracked(filterHistory(history, ALL_MODULES, 0), tracked);

                        const markAsReadEvents = filterTracked(filterHistory(history, ALL_MODULES, 1), tracked);
                        const counterMayHaveChanged = markAsReadEvents.length || newCommentEvents.length;

                        if (showPreviews) {
                            setTotalItems(null);

                            notifications.notifyAll(newCommentEvents);
                        } else if (counterMayHaveChanged) {
                            updateUnreadCounter(requests, tracked)
                                .then(() => notifications.notifyAll(newCommentEvents));
                        }

                        nextTid = next_tid;
                        chrome.storage.sync.set({lastTid: next_tid});
                    },
                    (tryFixForbidden) => tryFixForbidden && console.log('Forbidden!')
                );
        });
    }, initialConfig.pingMs);

    if (initialConfig.showPreviews) {
        setTotalItems(null);
    } else {
        updateUnreadCounter(new Requests(initialConfig.twHost), initialConfig.tracked);
    }
});

chrome.notifications.onClicked.addListener((notificationId) => {
    chrome.storage.sync.get('twHost', ({twHost}) => {
        chrome.tabs.create({url: twHost + notificationId})
    });
});
