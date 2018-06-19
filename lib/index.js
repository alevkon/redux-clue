import { createSelector } from 'reselect';
import { Record, Map } from 'immutable';
import { call, take, put, select } from 'redux-saga/effects';
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

const moduleName = 'clue';

const DEFAULT_OPTIONS = {
  storeKey: moduleName,
  apiPrefix: 'api',
  apiPluralize: false,
  clueToRequestUrl: (clue, apiOptions) => {
    switch (clue.query) {
      case queries.CREATE: {
        return `/${apiOptions.apiPrefix}/${clue.identity}`;
      }
      case queries.FIND_BY_ID:
        return `/${apiOptions.apiPrefix}/${clue.identity}/${clue.id}`;
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
          if (clue[key] != undefined) {
            searchHash[key] = clue[key];
          }
        });
        const search = _.reduce(
          searchHash,
          (memo, v, k) => {
            if (v !== undefined) { return memo; }
            return `${memo ? '&' : '?'}${k}=${(v && typeof v === 'object') ? JSON.stringify(v) : v}`;
          },
          ''
        );
        return `/${apiOptions.apiPrefix}/${apiOptions.pluralize ? pluralize(clue.identity) : clue.identity}${search}`;
      }
    }
  },
  clueToHttpMethod: (clue, apiOptions) => {
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
  clueToRequestBodyData: (clue, apiOptions) => {
    switch (clue.query) {
      case queries.CREATE:
        return clue.data;
      default:
        return {};
    }
  },
  clueToRequestHeaders: (clue, apiOptions) => {
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

  data: null
};

const DEFAULT_ACTION_OPTIONS = {
  force: false,
  marker: null
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
    const markerPart = this.marker ? `:${this.marker}` : '';
    switch (event) {
      case events.REQUEST:
        return `${moduleName}:${event}:${this.identity}:${this.query}${markerPart}:${this.serialize()}`;
      case events.SUCCESS:
      case events.ERROR:
        return `${moduleName}:${event}:${this.identity}:${this.query}${markerPart}`;
    }
  }

  doesFitPseudoClue(pseudoClue) {
    return this.identity === pseudoClue.identity && this.query === pseudoClue.query;
  }

  static pseudoClueFromActionType(actionType) {
    const parts = actionType.split(':');
    if (parts.length < 4) { return null; }
    if (parts[0] !== moduleName) { return null; }

    let data = {
      event: parts[1],
      identity: parts[2],
      query: parts[3]
    };

    if (data.query === queries.FIND_BY_ID) {
      data.id = parts[4];
    }

    return data;
  }
}

const MetaRecord = Record({
  clue: null,
  fetchedAt: null,
  responseMeta: null,
  custom: null
});

const ItemRecord = Record({
  originalRequestId: null,
  lastRequestId: null,
  pending: false,
  error: false,
  data: null,
  meta: new MetaRecord(),
});

const IdentityRecord = Record({
  [queries.FIND_BY_ID]: new Map(),
  [queries.FIND_ONE]: new Map(),
  [queries.FIND]: new Map(),
  [queries.CREATE]: new Map()
});

export default (optionsRaw) => {
  const apiOptions = _.merge({}, DEFAULT_OPTIONS, optionsRaw);

  const defaultStateData = _.reduce(
    apiOptions.models,
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
    return state[apiOptions.storeKey].get(clue.identity);
  };

  let requestCounter = 0;
  const api = {
    selectors: {
      identitySelector,
      byClue: (propsToClue, options) => createSelector(
        [
          identitySelector(propsToClue),
          (state, props) => {
            const clueData = propsToClue(props);
            return clueData instanceof Clue
              ? clueData
              : new Clue(clueData);
          }
        ],
        (identityRecord, clue) => {
          const queryMap = identityRecord[clue.query];
          if (clue.query === queries.CREATE && options && options.marker) {
            const markerInstances = queryMap.get(options.marker);
            if ((options && options.index) != undefined) {
              return markerInstances && markerInstances[options.index];
            }
            return markerInstances;
          }
          return queryMap.get(clue.serialize());
        }
      )
    },
    actions: {
      byClue: (clueData, options) => {
        const clue = clueData instanceof Clue ? clueData : new Clue(clueData);

        const action = {
          type: clue.toActionType(),
          payload: {
            options,
            requestId: ++requestCounter,
            clue
          }
        };

        return action;
      },
      success: (requestId, clue, responseMeta, data, options) => ({
        type: clue.toActionType(events.SUCCESS, requestId),
        payload: {
          requestId,
          clue,
          responseMeta,
          data,
          options
        }
      }),
      error: (requestId, clue, responseMeta, data, options) => ({
        type: clue.toActionType(events.ERROR, requestId),
        payload: {
          requestId,
          clue,
          responseMeta,
          data,
          options
        }
      })
    },
    reducer: (state = defaultState, action) => {
      if (!action) { return state; }

      const { type, payload } = action;
      const pseudoClue = Clue.pseudoClueFromActionType(type);
      if (!pseudoClue) { return state; }

      const { clue, requestId, responseMeta, data, options } = payload;
      if (!clue.doesFitPseudoClue(pseudoClue)) {
        throw new Error('Clue should fit data from action.type');
      }

      switch (pseudoClue.event) {
        case events.REQUEST: {
          const existingItem = api.selectors.byClue(() => clue, options)({ [apiOptions.storeKey]: state });
          if (existingItem && !(options && options.force)) { return state; }
          const requestedItem = new ItemRecord({
            originalRequestId: payload.requestId,
            lastRequestId: payload.requestId,
            pending: true,
            meta: new MetaRecord({ clue })
          });

          let key = clue.serialize();
          let value = requestedItem;
          if (clue.query === queries.CREATE && options && options.marker) {
            key = options.marker;
            try {
              const existingArray = state.get(clue.identity).get(clue.query).get(key);
              value = existingArray.concat([requestedItem]);
            } catch(err) {
              value = [requestedItem];
            }
          }

          return state.mergeDeep({
            _requests: {
              [requestId]: requestedItem
            },
            [clue.identity]: {
              [clue.query]: {
                [key]: value
              }
            }
          });
        }
        case events.SUCCESS:
        case events.ERROR: {
          const isError = pseudoClue.event === events.ERROR;

          const resultItem = new ItemRecord({
            [isError ? "error" : "success"]: true,
            meta: new MetaRecord({
              clue,
              responseMeta: responseMeta,
              fetchedAt: new Date()
            }),
            data
          });

          let key = clue.serialize();
          let value = resultItem;
          if (clue.query === queries.CREATE && options && options.marker) {
            key = options.marker;

            const existingArray = state.get(clue.identity).get(clue.query).get(key);
            const index = _.findIndex(existingArray.toJSON(), item => item.lastRequestId === payload.requestId);;

            if (index < 0) {
              return state;
            }
            value = existingArray.slice(0, index)
              .concat([resultItem])
              .concat(existingArray.slice(index + 1));
          }

          const patch = {
            [clue.identity]: {
              [clue.query]: {
                [key]: value
              }
            }
          };
          let statePrepatched = state;
          if (isError) {
            patch._requests = {
              [requestId]: resultItem
            }
          } else {
            statePrepatched = statePrepatched.set('_requests', state._requests.delete(String(requestId)))
          }

          return statePrepatched.mergeDeep(patch);
        }
      }

      return state;
    },

    saga: function* saga() {
      while (true) {
        const action = yield take((action) => {
          const pseudoClue = Clue.pseudoClueFromActionType(action.type);
          if (!pseudoClue) { return false; }

          return pseudoClue.event === events.REQUEST;
        });

        yield call(workerSaga, action);
      }
    }
  };

  const workerSaga = function* (action) {
    const { type, payload } = action;
    const { identity, clue, subtype, options } = payload;

    const pseudoClue = Clue.pseudoClueFromActionType(type);
    if (!pseudoClue) { return; }

    switch (pseudoClue.query) {
      case queries.CREATE:
      case queries.FIND:
      case queries.FIND_BY_ID:
      case queries.FIND_ONE: {
        // const existingItem = api.selectors.byClue(() => clue)({ [apiOptions.storeKey]: state });
        if (pseudoClue.query !== queries.CREATE) {
          const existingItem = yield select(
            rootState =>
            api.selectors.byClue(() => clue)(_.pick(rootState, apiOptions.storeKey))
          );
          if (existingItem
            && !existingItem.error
            && !(options && options.force)
            && existingItem.originalRequestId !== payload.requestId
          ) { return; }
        }

        const url = apiOptions.clueToRequestUrl(clue, apiOptions);
        const method = apiOptions.clueToHttpMethod(clue, apiOptions);
        const data = apiOptions.clueToRequestBodyData(clue, apiOptions);
        const headers = apiOptions.clueToRequestHeaders(clue, apiOptions);

        const response = yield call(axios.request, {
          ...(apiOptions.axios),
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
            response.data,
            options
          ));
        } else {
          yield put(api.actions.error(
            payload.requestId,
            clue,
            { ...(response.headers), status: response.status },
            response.data,
            options
          ));
        }
        break;
      }
    }
  };

  return api;
}