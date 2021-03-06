/* @flow */
'use strict';

import AbstractMethod from './AbstractMethod';
import { validateParams, validateCoinPath, getFirmwareRange } from './helpers/paramsValidator';
import { validatePath } from '../../utils/pathUtils';

import * as UI from '../../constants/ui';
import { UiMessage } from '../../message/builder';

import { getBitcoinNetwork } from '../../data/CoinInfo';
import { getPublicKeyLabel } from '../../utils/pathUtils';
import type { HDNodeResponse } from '../../types/trezor';
import type { CoreMessage, UiPromiseResponse, BitcoinNetworkInfo } from '../../types';

type Batch = {
    path: Array<number>,
    coinInfo: ?BitcoinNetworkInfo,
}
type Params = Array<Batch>;

export default class GetPublicKey extends AbstractMethod {
    params: Params;
    hasBundle: boolean;
    confirmed: boolean = false;

    constructor(message: CoreMessage) {
        super(message);

        this.requiredPermissions = ['read'];
        this.info = 'Export public key';

        // create a bundle with only one batch if bundle doesn't exists
        this.hasBundle = message.payload.hasOwnProperty('bundle');
        const payload: Object = !this.hasBundle ? { ...message.payload, bundle: [ ...message.payload ] } : message.payload;

        // validate bundle type
        validateParams(payload, [
            { name: 'bundle', type: 'array' },
        ]);

        const bundle = [];
        payload.bundle.forEach(batch => {
            // validate incoming parameters for each batch
            validateParams(batch, [
                { name: 'path', obligatory: true },
                { name: 'coin', type: 'string' },
                { name: 'crossChain', type: 'boolean' },
            ]);

            let coinInfo: ?BitcoinNetworkInfo;
            if (batch.coin) {
                coinInfo = getBitcoinNetwork(batch.coin);
            }

            const path: Array<number> = validatePath(batch.path, coinInfo ? 3 : 0);

            if (coinInfo && !batch.crossChain) {
                validateCoinPath(coinInfo, path);
            } else if (!coinInfo) {
                coinInfo = getBitcoinNetwork(path);
            }
            bundle.push({
                path,
                coinInfo,
            });

            // set required firmware from coinInfo support
            if (coinInfo) {
                this.firmwareRange = getFirmwareRange(this.name, coinInfo, this.firmwareRange);
            }
        });

        this.params = bundle;
    }

    async confirmation(): Promise<boolean> {
        if (this.confirmed) return true;
        // wait for popup window
        await this.getPopupPromise().promise;
        // initialize user response promise
        const uiPromise = this.createUiPromise(UI.RECEIVE_CONFIRMATION, this.device);
        let label: string;
        if (this.params.length > 1) {
            label = 'Export multiple public keys';
        } else {
            label = getPublicKeyLabel(this.params[0].path, this.params[0].coinInfo);
        }

        // request confirmation view
        this.postMessage(new UiMessage(UI.REQUEST_CONFIRMATION, {
            view: 'export-xpub',
            label,
        }));

        // wait for user action
        const uiResp: UiPromiseResponse = await uiPromise.promise;

        this.confirmed = uiResp.payload;
        return this.confirmed;
    }

    async run(): Promise<HDNodeResponse | Array<HDNodeResponse>> {
        const responses: Array<HDNodeResponse> = [];
        for (let i = 0; i < this.params.length; i++) {
            const batch: Batch = this.params[i];
            const response: HDNodeResponse = await this.device.getCommands().getHDNode(
                batch.path,
                batch.coinInfo
            );
            responses.push(response);

            if (this.hasBundle) {
                // send progress
                this.postMessage(new UiMessage(UI.BUNDLE_PROGRESS, {
                    progress: i,
                    response,
                }));
            }
        }
        return this.hasBundle ? responses : responses[0];
    }
}
