'use strict';

const setStatus = (status) => {
    document.getElementById('status').innerHTML = status;
};

const setField = (id, value, defValue = '') => {
    const el = document.getElementById(id);

    if (el.type === 'checkbox') {
        el.checked = value;
    } else if (el) {
        el.value = value || defValue;
    }
};
const getField = (id, defValue = '') => {
    const el = document.getElementById(id);

    if (!el) {
        return defValue;
    }

    if (el.type === 'checkbox') {
        return el.checked;
    }

    return el.value;
};

const trackedItemsToUrlList = (tracked) => tracked.map((item) => item.original_url).filter((url) => url).join("\n");

const urlListToTrackedItems = (stringUrlList) =>
    stringUrlList.split("\n")
        .map((line) => line.trim())
        .map(parseUrl)
        .filter((trackedItem) => trackedItem && trackedItem.module_id && trackedItem.record_id);

const parseUrl = (url) => {
    const moduleNameToIdMap = {
        tasks: 4,
        servicedesk: 22
    };

    try {
        const [, moduleName, id] = /\/(tasks|servicedesk)\/view\/(\d+)/.exec(url);

        return {
            module_id: moduleNameToIdMap[moduleName],
            record_id: parseInt(id),
            original_url: url
        };
    } catch (err) {
        return null;
    }
};

document.getElementById('save').addEventListener('click', () => {
    setStatus('Saving...');

    const setOpts = {
        twHost: getField('twHost'),
        tracked: urlListToTrackedItems(getField('tracked')),
        showPreviews: getField('showPreviews')
    };
    chrome.storage.sync.set(setOpts, () => {
        setStatus('Saved');

        chrome.storage.sync.get(null, (options) => {
            console.log('options after save', options);
        });
    });
});

chrome.storage.sync.get(null, (options) => {
    setStatus('');

    setField('twHost', options.twHost, 'https://tw.fxtm.com');
    setField('tracked', trackedItemsToUrlList(options.tracked));
    setField('showPreviews', options.showPreviews);
});

