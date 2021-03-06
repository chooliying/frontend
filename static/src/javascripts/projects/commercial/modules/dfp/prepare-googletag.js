// @flow

import qwery from 'qwery';
import raven from 'lib/raven';
import config from 'lib/config';
import fastdom from 'lib/fastdom-promise';
import sha1 from 'lib/sha1';
import { session } from 'lib/storage';
import { getUserFromCookie } from 'common/modules/identity/api';
import { loadScript } from 'lib/load-script';
import { commercialFeatures } from 'common/modules/commercial/commercial-features';
import { buildPageTargeting } from 'common/modules/commercial/build-page-targeting';
import { dfpEnv } from 'commercial/modules/dfp/dfp-env';
import { onSlotRender } from 'commercial/modules/dfp/on-slot-render';
import { onSlotLoad } from 'commercial/modules/dfp/on-slot-load';
import { onSlotViewableFunction } from 'commercial/modules/dfp/on-slot-viewable';
import { onSlotVisibilityChanged } from 'commercial/modules/dfp/on-slot-visibility-changed';
import { fillAdvertSlots } from 'commercial/modules/dfp/fill-advert-slots';
import { refreshOnResize } from 'commercial/modules/dfp/refresh-on-resize';
import { adFreeSlotRemove } from 'commercial/modules/close-disabled-slots';
import {
    addTag,
    setListeners,
} from 'commercial/modules/dfp/performance-logging';

import { init as initMessenger } from 'commercial/modules/messenger';

import { init as type } from 'commercial/modules/messenger/type';
import { init as getStyles } from 'commercial/modules/messenger/get-stylesheet';
import { init as getPageTargeting } from 'commercial/modules/messenger/get-page-targeting';
import { init as hide } from 'commercial/modules/messenger/hide';
import { init as resize } from 'commercial/modules/messenger/resize';
import { init as scroll } from 'commercial/modules/messenger/scroll';
import { init as viewport } from 'commercial/modules/messenger/viewport';
import { init as sendClick } from 'commercial/modules/messenger/click';
import { init as background } from 'commercial/modules/messenger/background';
import { init as disableRefresh } from 'commercial/modules/messenger/disable-refresh';

initMessenger(
    type,
    getStyles,
    getPageTargeting,
    resize,
    hide,
    scroll,
    viewport,
    sendClick,
    background,
    disableRefresh
);

const setDfpListeners = (): void => {
    setListeners(window.googletag);

    const pubads = window.googletag.pubads();
    pubads.addEventListener('slotRenderEnded', raven.wrap(onSlotRender));
    pubads.addEventListener('slotOnload', raven.wrap(onSlotLoad));

    pubads.addEventListener('impressionViewable', onSlotViewableFunction());

    pubads.addEventListener('slotVisibilityChanged', onSlotVisibilityChanged);
    if (session.isAvailable()) {
        const pageViews = session.get('gu.commercial.pageViews') || 0;
        session.set('gu.commercial.pageViews', pageViews + 1);
    }
};

const setPersonalisedAds = (): void => {
    if (config.switches.includePersonalisedAdsConsent) {
        // TODO: replace this hardcoded value with one from local storage
        const personalised = false;
        window.googletag
            .pubads()
            .setRequestNonPersonalizedAds(personalised ? 0 : 1);
    }
};

const setPageTargeting = (): void => {
    const pubads = window.googletag.pubads();
    // because commercialFeatures may export itself as {} in the event of an exception during construction
    const targeting = buildPageTargeting(commercialFeatures.adFree || false);
    Object.keys(targeting).forEach(key => {
        pubads.setTargeting(key, targeting[key]);
    });
};

// This is specifically a separate function to close-disabled-slots. One is for
// closing hidden/disabled slots, the other is for graceful recovery when prepare-googletag
// encounters an error. Here, slots are closed unconditionally.
const removeAdSlots = (): Promise<void> => {
    // Get all ad slots
    const adSlots: Array<Element> = qwery(dfpEnv.adSlotSelector);

    return fastdom.write(() =>
        adSlots.forEach((adSlot: Element) => adSlot.remove())
    );
};

const setPublisherProvidedId = (): void => {
    const user: ?Object = getUserFromCookie();
    if (user) {
        const hashedId = sha1.hash(user.id);
        window.googletag.pubads().setPublisherProvidedId(hashedId);
    }
};

export const init = (start: () => void, stop: () => void): Promise<void> => {
    const setupAdvertising = (): Promise<void> => {
        addTag(
            dfpEnv.externalDemand === 'none'
                ? 'waterfall'
                : dfpEnv.externalDemand
        );

        start();

        // note: fillAdvertSlots isn't synchronous like most buffered cmds, it's a promise. It's put in here to ensure
        // it strictly follows preceding prepare-googletag work (and the module itself ensures dependencies are
        // fulfilled), but don't assume fillAdvertSlots is complete when queueing subsequent work using cmd.push
        window.googletag.cmd.push(
            setDfpListeners,
            setPersonalisedAds,
            setPageTargeting,
            setPublisherProvidedId,
            refreshOnResize,
            () => {
                fillAdvertSlots().then(stop);
            }
        );

        // Just load googletag. Sonobi's wrapper will already be loaded, and googletag is already added to the window by sonobi.
        return loadScript(config.libs.googletag, { async: false });
    };

    if (commercialFeatures.dfpAdvertising) {
        if (commercialFeatures.adFree) {
            setupAdvertising()
                .then(adFreeSlotRemove)
                .catch(removeAdSlots);
            return Promise.resolve();
        }
        // A promise error here, from a failed module load,
        // could be a network problem or an intercepted request.
        // Abandon the init sequence.
        setupAdvertising().catch(removeAdSlots);
        return Promise.resolve();
    }
    return removeAdSlots().then(stop);
};
