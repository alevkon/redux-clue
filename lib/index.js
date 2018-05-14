import { createSelector } from 'reselect';
import { Record, Map } from 'immutable';
import { all, call, select, takeEvery, put } from 'redux-saga/effects';
import axios from 'axios';
import pluralize from 'pluralize';
import _ from 'lodash';

export const events = {
  REQUEST: 'request',
  SUCCESS: 'success',
  ERROR: 'error'
};

export const queries = {
  FIND_BY_ID: 'findById',
  FIND_ONE: 'findOne',
  FIND: 'find',
  UPDATE: 'update',
  CREATE: 'create',
  DELETE: 'delete'
};

const moduleName = 'redux-clue';

const DEFAULT_OPTIONS = {
  storeKey: moduleName,
  apiPrefix: 'api',
  apiPluralize: false,
  clueToRequestUrl: (clue, options) => {
    switch (clue.query) {
      case queries.FIND_BY_ID:
        return `/${options.apiPrefix}/${clue.identity}/${clue.id}`;
      case queries.FIND_ONE:
      case queries.FIND: {
        let searchHash = {};
        _.each(
          clue.where,
          (v, k) => {
            searchHash[k] = v;
          },
        );
        ['limit', 'skip', 'filter', 'sort', 'select'].forEach((key) => {
          searchHash[key] = clue[key];
        });
        const search = _.reduce(
          searchHash,
          (memo, v, k) => {
            if (v !== undefined) { return memo; }
            return `${memo ? '&' : '?'}${k}=${(v && typeof v === 'object') ? JSON.stringify(v) : v}`;
          },
          ''
        );
        return `/${options.apiPrefix}/${options.pluralize ? pluralize(clue.identity) : clue.identity}${search}`;
      }
    }
  },
  clueToHttpMethod: (clue, options) => {
    switch (clue.query) {
      case queries.FIND:
      case queries.FIND_ONE:
      case queries.FIND_BY_ID:
        return 'get';
      case queries.CREATE:
        return 'post';
      case queries.UPDATE:
        return 'put';
      case queries.DELETE:
        return 'delete';
    }
  },
  clueToRequestBodyData: (clue, options) => {
    return {};
  },
  clueToRequestHeaders: (clue, options) => {
    return {};
  }
};

const CLUE_DEFAULTS = {
  query: queries.FIND_BY_ID,

  identity: null,
  id: null,

  limit: 0,
  skip: 0,
  where: undefined,
  filter: undefined,
  sort: undefined,
  select: undefined,

  force: false
};

export class Clue {
  constructor(data) {
    Object.keys(CLUE_DEFAULTS).forEach((key) => {
      this[key] = data[key] === undefined ? CLUE_DEFAULTS[key] : data[key];
    });
  }

  serialize() {
    return this.query === queries.FIND_BY_ID
      ? String(this.id)
      : JSON.stringify(this);
  }

  toActionType(event = events.REQUEST, requestId) {
    switch (event) {
      case events.REQUEST:
        return `${moduleName}:${requestId}:${event}:${this.identity}:${this.query}:${this.serialize()}`;
      case events.SUCCESS:
      case events.ERROR:
        return `${moduleName}:${requestId}:${event}:${this.identity}:${this.query}`;
    }
  }

  doesFitPseudoClue(pseudoClue) {
    return this.identity === pseudoClue.identity && this.query === pseudoClue.query;
  }

  static pseudoClueFromActionType(actionType) {
    const parts = actionType.split(':');
    if (parts.length < 5) { return null; }
    if (parts[0] !== moduleName) { return null; }

    let data = {
      requestId: parts[1],
      event: parts[2],
      identity: parts[3],
      query: parts[4]
    };

    if (data.query === queries.FIND_BY_ID) {
      data.id = parts[5];
    }

    return data;
  }
}

const MetaRecord = Record({
  clue: null,
  fetchedAt: null,
  fromResponse: null,
  custom: null
});

const ItemRecord = Record({
  pending: false,
  error: false,
  data: null,
  meta: new MetaRecord()
});

const IdentityRecord = Record({
  [queries.FIND_BY_ID]: new Map(),
  [queries.FIND_ONE]: new Map(),
  [queries.FIND]: new Map()
});

export default (optionsRaw) => {
  const options = _.merge({}, optionsRaw, DEFAULT_OPTIONS);

  const defaultStateData = _.reduce(
    options.models,
    (memo, identity) => {
      memo[identity] = new IdentityRecord();
      return memo;
    }, {
      _requests: new Map()
    }
  );

  const defaultState = new (Record(defaultStateData))();

  const identitySelector = (propsToClue) => (state, props) => {
    const clue = propsToClue(props);
    return state[options.storeKey].get(clue.identity);
  };

  const api = {
    selectors: {
      identitySelector,
      byClue: (propsToClue) => createSelector(
        [
          identitySelector(propsToClue),
          (state, props) => propsToClue(props)
        ],
        (identityRecord, clue) => {
          return identityRecord[clue.query].get(clue.serialize());
        }
      )
    },
    actions: {
      byClue: clueData => {
        const clue = clueData instanceof Clue ? clueData : new Clue(clueData);
        return {
          type: clue.toActionType(),
          payload: { clue }
        }
      },
      success: (requestId, clue, responseMeta, data) => ({
        type: clue.toActionType(events.SUCCESS, requestId),
        payload: {
          requestId,
          clue,
          responseMeta,
          data
        }
      }),
      error: (requestId, clue, responseMeta, data) => ({
        type: clue.toActionType(events.ERROR, requestId),
        payload: {
          requestId,
          clue,
          responseMeta,
          data
        }
      })
    },
    reducer: (state = defaultState, action) => {
      if (!action) { return state; }

      const { type, payload } = action;
      const pseudoClue = Clue.pseudoClueFromActionType(type);
      if (!pseudoClue) { return state; }

      const { clue, requestId, responseMeta, data } = payload;
      if (!clue.doesFitPseudoClue(pseudoClue)) {
        throw new Error('Clue should fit data from action.type');
      }

      switch (pseudoClue.event) {
        case events.REQUEST: {
          const existingItem = api.selectors.byClue(() => clue)({ [options.storeKey]: state });
          if (existingItem && !clue.force) { return state; }
          const requestedItem = new ItemRecord({
            pending: true,
            meta: new MetaRecord({ clue })
          });
          return state.mergeDeep({
            _requests: {
              [requestId]: requestedItem
            },
            [clue.identity]: {
              [clue.query]: {
                [clue.serialize()]: requestedItem
              }
            }
          });
        }
        case events.SUCCESS: {
          const successItem = new ItemRecord({
            success: true,
            meta: new MetaRecord({
              clue,
              fromResponse: responseMeta,
              fetchedAt: new Date()
            }),
            data
          });
          return state
            .set('_requests', state._requests.delete(String(requestId)))
            .mergeDeep({
              [clue.identity]: {
                [clue.query]: {
                  [clue.serialize()]: successItem
                }
              }
            });
        }
        case events.ERROR: {
          const errorItem = new ItemRecord({
            error: true,
            meta: new MetaRecord({
              clue,
              fromResponse: responseMeta,
              fetchedAt: new Date()
            }),
            data
          });
          return state.mergeDeep({
            _requests: {
              [requestId]: errorItem
            },
            [clue.identity]: {
              [clue.query]: {
                [clue.serialize()]: errorItem
              }
            }
          });
        }
      }

      return state;
    },

    saga: function* saga() {
      yield take((action) => {
        const pseudoClue = Clue.pseudoClueFromActionType(action.type);
        if (!pseudoClue) { return false; }

        return pseudoClue.event === events.REQUEST;
      }, workerSaga);
    }
  };

  let requestCounter = 0;
  const workerSaga = function* (action) {
    const { type, payload } = action;
    const { identity, clue, subtype } = payload;
    payload.requestId = ++requestCounter;

    const pseudoClue = Clue.pseudoClueFromActionType(type);
    if (!pseudoClue) { return; }

    switch (pseudoClue.query) {
      case queries.FIND:
      case queries.FIND_BY_ID:
      case queries.FIND_ONE: {
        const existingItem = api.selectors.byClue(() => clue)({ [options.storeKey]: state });
        if (existingItem && !existingItem.error && !clue.force) { return ; }

        const url = options.clueToRequestUrl(clue);
        const method = options.clueToHttpMethod(clue);
        const data = options.clueToRequestBodyData(clue);
        const headers = options.clueToRequestHeaders(clue);

        const response = yield call (axios.request, {
          ...(options.axios),
          url,
          method,
          headers,
          data
        });

        const statusFloored = 100 * Math.floor(response.status / 100);
        if (statusFloored === 200) {
          yield put(api.actions.success(
            payload.requestId,
            clue,
            response.headers,
            response.data
          ));
        } else {
          yield put(api.actions.error(
            payload.requestId,
            clue,
            { ...(response.headers), status: response.status },
            response.data
          ));
        }
        break;
      }
    }
  };

  return api;
}