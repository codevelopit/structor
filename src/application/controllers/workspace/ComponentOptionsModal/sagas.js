/*
 * Copyright 2015 Alexander Pustovalov
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { fork, take, call, put, race, cancel } from 'redux-saga/effects';
import { SagaCancellationException } from 'redux-saga';
import * as actions from './actions.js';
import { actions as spinnerActions } from '../../app/AppSpinner/index.js';
import { actions as messageActions } from '../../app/AppMessage/index.js';
import { serverApi, graphApi } from '../../../api/index.js';
import { pushHistory } from '../HistoryControls/actions.js';
import { updatePage } from '../DeskPage/actions.js';
import { setSelectedKey } from '../SelectionBreadcrumbs/actions.js';

const delay = ms => new Promise(resolve => setTimeout(() => resolve('timed out'), ms));

function* delaySaveComponentSourceCode(){
    try{
        yield call(delay, 10000);
        yield put(messageActions.timeout('Saving source code is timed out. Check the console output for errors.'));
        yield put(actions.setReloadPageRequest());
        yield put(actions.saveSourceCodeTimeout());
    } catch(e){
        if (e instanceof SagaCancellationException) {
            // do nothing
        }
    }
}

function* saveComponentSourceCode(options){
    console.log('Save component source code: ', JSON.stringify(options, null, 4));
    try {
        const {key, sourcePropsObj, text, sourceCode, sourceFilePath} = options;
        let node = graphApi.getNode(key);
        if (node) {
            if(sourceCode && sourceFilePath){
                yield call(serverApi.writeComponentSource, sourceFilePath, sourceCode);
            }
            yield put(pushHistory());
            node.modelNode.props = sourcePropsObj;
            node.modelNode.text = text;
            yield put(setSelectedKey(key));
            yield put(updatePage());
            yield put(actions.hideModal());
        } else {
            yield put(messageActions.failed('Saving source code error. Error: component with key ' + key + ' was not found.'));
        }
        yield put(actions.saveSourceCodeDone());
    } catch (error) {
        console.error(error);
        if (error instanceof SagaCancellationException) {
            // do nothing
        } else {
            yield put(messageActions.failed('Saving source code error. Error: ' + (error.message ? error.message : error)));
            yield put(actions.saveSourceCodeDone());
        }
    }
}

function* saveSourceCode(){
    while(true){
        const { payload } = yield take(actions.SAVE_SOURCE_CODE);
        console.log(JSON.stringify(payload, null, 4));
        yield put(spinnerActions.started('Saving source code'));
        const saveTask = yield fork(saveComponentSourceCode, payload);
        const delayTask = yield fork(delaySaveComponentSourceCode);
        yield take([actions.SAVE_SOURCE_CODE_DONE, actions.SAVE_SOURCE_CODE_TIMEOUT]);
        yield cancel(saveTask);
        yield cancel(delayTask);
        yield put(spinnerActions.done('Saving source code'));
    }
}

function* loadComponentOptions(componentName, sourceFilePath){
    try{
        return yield call(serverApi.loadComponentOptions, componentName, sourceFilePath);
    } catch(error){
        if(error instanceof SagaCancellationException){
            yield put(messageActions.failed('Loading component options was canceled.'));
        } else {
            yield put(messageActions.failed('Loading component options error. Error: ' + (error.message ? error.message : error)));
        }
    }
}

function* loadOptions(){
    while(true){
        const { payload } = yield take(actions.LOAD_OPTIONS);
        yield put(spinnerActions.started('Loading component options'));
        try {
            const {sourceFilePath, componentName} = payload;
            const {timeout, response} = yield race({
                response: call(loadComponentOptions, componentName, sourceFilePath),
                timeout: call(delay, 10000)
            });
            if(response){
                yield put(actions.showModal({...payload, ...response}));
            } else if(timeout) {
                yield put(messageActions.timeout('Loading component options is timed out.'));
            }
        } catch(error) {
            yield put(messageActions.failed('Loading component options error. Error: ' + (error.message ? error.message : error)));
        }
        yield put(spinnerActions.done('Loading component options'));
    }
}

// main saga
export default function* mainSaga() {
    yield [fork(loadOptions), fork(saveSourceCode)];
};
