import { createSelector } from 'reselect';
import { Record, Map } from 'immutable';
import { call, takeEvery, put, select } from 'redux-saga/effects';
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

const searchToString = search => _.reduce(
  search,
  (memo, v, k) => {
    if (v == undefined) { return memo; }
    const value = typeof v === "object"
      ? JSON.stringify(v)
      : v;
    return `${memo}${memo ? '&' : '?'}${k}=${value}`;
  },
  ''
);

const getSearchHashByClue = (clue, options = {}) => {
  let searchHash = {};

  (options.pick || ['limit', 'skip', 'filter', 'sort', 'select', 'populate', 'where']).forEach((key) => {
    if (key === 'where') {
      _.each(
        clue.where,
        (v, k) => {
          searchHash[k] = v;
        },
      );
      return
    }

    const isEmpty = key === "limit"
      ? clue[key] == undefined
      : !clue[key];

    if (!isEmpty) {
      const value = typeof clue[key] === "object"
        ? JSON.stringify(clue[key])
        : clue[key];
      searchHash[key] = value;
    }
  });
  if (searchHash.limit == undefined && clue.query === queries.FIND_ONE) {
    searchHash.limit = 1;
  }

  return searchHash;
}

const DEFAULT_OPTIONS = {
  storeKey: moduleName,
  apiPrefix: 'api',
  apiPluralize: false,
  idAttribute: "id",
  clueToRequestUrl: (clue, apiOptions) => {
    const apiIdentity = apiOptions.pluralize ? pluralize(clue.identity) : clue.identity;
    switch (clue.query) {
      case queries.CREATE: {
        const searchHash = getSearchHashByClue(clue, { pick: ["populate", "select"] })
        const search = searchToString(searchHash);
        return `/${apiOptions.apiPrefix}/${apiIdentity}${search}`;
      }
      case queries.UPDATE:
      case queries.FIND_BY_ID:
      case queries.DELETE: {
        const searchHash = getSearchHashByClue(clue, { pick: ["populate", "select"] })
        const search = searchToString(searchHash);

        return `/${apiOptions.apiPrefix}/${apiIdentity}/${clue.id}${searchToString(clue.search)}${search}`;
      }
      case queries.FIND_ONE:
      case queries.FIND: {
        const searchHash = getSearchHashByClue(clue);
        if (searchHash.limit == undefined && clue.query === queries.FIND_ONE) {
          searchHash.limit = 1;
        }
        const search = searchToString(searchHash);
        return `/${apiOptions.apiPrefix}/${apiIdentity}${search}`;
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
      case queries.UPDATE:
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

  limit: null,
  skip: 0,
  where: undefined,
  filter: undefined,
  sort: undefined,
  select: undefined,
  search: undefined,
  populate: undefined,

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
    return (this.query === queries.FIND_BY_ID || this.query === queries.DELETE)
      ? String(this.id)
      : JSON.stringify(this);
  }

  toActionType(event = events.REQUEST, requestId) {
    switch (event) {
      case events.REQUEST:
        return `${moduleName}:${event}:${this.identity}:${this.query}:${this.serialize()}`;
      case events.SUCCESS:
      case events.ERROR:
        return `${moduleName}:${event}:${this.identity}:${this.query}`;
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
  options: null,
  fetchedAt: null,
  responseMeta: null,
  custom: null
});

const ItemRecord = Record({
  originalRequestId: null,
  lastRequestId: null,
  pending: false,
  updating: false,
  error: false,
  success: false,
  data: null,
  createdByUpdate: false,

  // todo: make this array
  updates: {},
  meta: new MetaRecord()
});

const IdentityRecord = Record({
  [queries.FIND_BY_ID]: new Map(),
  [queries.FIND_ONE]: new Map(),
  [queries.FIND]: new Map(),
  [queries.CREATE]: new Map(),
  [queries.DELETE]: new Map()
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

  const identitySelector = (identity) => (state, props) => {
    const identityComputed = typeof identity ==="function" ? identity(props) : identity;
    return state[apiOptions.storeKey].get(identityComputed);
  };

  const querySelector = (identity, query) => createSelector(
    [
      identitySelector(identity),
      (state, props) => typeof query ==="function" ? query(props) : query
    ],
    (identityRecord, queryComputed) => identityRecord.get(queryComputed)
  )

  let requestCounter = 0;
  const api = {
    selectors: {
      identitySelector,
      querySelector,
      byRequestId: (requestId, options) => (state, props) => {
        const request = state[apiOptions.storeKey]._requests.get(String(requestId))
        return (options && options.resultOnly)
          ? request && request.get("result")
          : request
      },
      byClue: (propsToClue, optionsArg) => createSelector(
        [
          querySelector(
            (props) => {
              const clue = typeof propsToClue === "function"
                ? propsToClue(props)
                : clue;
              return clue.identity;
            },
            (props) => {
              const clue = typeof propsToClue === "function"
                ? propsToClue(props)
                : clue;
              return clue.query;
            }
          ),
          (state, props) => {
            const clueData = propsToClue(props);
            return clueData instanceof Clue
              ? clueData
              : new Clue(clueData);
          },
          (state, props) => {
            return typeof optionsArg === "function"
              ? optionsArg(props)
              : optionsArg;
          }
        ],
        (queryMap, clue, options) => {
          // const queryMap = identityRecord[clue.query];

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
      update: (identity, id, patch, options) => {
        const clue = new Clue({
          query: queries.UPDATE,
          identity,
          id,
          data: patch
        });

        return {
          type: clue.toActionType(),
          payload: {
            options,
            requestId: ++requestCounter,
            clue
          }
        };
      },
      byClue: (clueData, options) => {
        const clue = clueData instanceof Clue ? clueData : new Clue(clueData);

        return {
          type: clue.toActionType(),
          payload: {
            options,
            requestId: ++requestCounter,
            clue
          }
        };
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

      const getPatchedIdentityRecordForUpdate = (identity, id, instanceRecordPatch) => {
        let identityRecord = state.get(identity);
        [queries.FIND_BY_ID, queries.FIND_ONE].forEach((query) => {
          let queryRecord = identityRecord.get(query);

          _.each(queryRecord.toJSON(), (instanceRecord, key) => {
            if (instanceRecord.data && !instanceRecord.error && instanceRecord.data[apiOptions.idAttribute] == id) {
              queryRecord = queryRecord.set(key, new ItemRecord(_.merge({}, instanceRecord, instanceRecordPatch)));
            } else if (instanceRecord.createdByUpdate && !instanceRecordPatch.updating && !instanceRecord.data) {
              const updatesKeys = Object.keys(instanceRecordPatch.updates);
              if (updatesKeys.length) {
                const patch = instanceRecordPatch.updates[updatesKeys[0]];
                queryRecord = queryRecord.set(key, new ItemRecord(_.merge(instanceRecord, patch)));
              }
            }
          });
          identityRecord = identityRecord.set(query, queryRecord);
        });

        // creating findById anyway
        let findByIdQueryRecord = identityRecord.get(queries.FIND_BY_ID);
        if (!Object.keys(findByIdQueryRecord.toJSON()).length) {
          findByIdQueryRecord = findByIdQueryRecord.set(id, new ItemRecord(
            Object.assign({
              createdByUpdate: true,
              pending: true
            }, instanceRecordPatch)
          ));
          identityRecord = identityRecord.set(queries.FIND_BY_ID, findByIdQueryRecord);
        }

        return identityRecord;
      };

      switch (pseudoClue.event) {
        case events.REQUEST: {
          if (clue.query === queries.UPDATE) {
            const request = {
              clue,
              options,
              pending: true,
              result: {
                pending: true
              }
            };

            return state.mergeDeep({
              _requests: {
                [requestId]: request
              },
              [clue.identity]: getPatchedIdentityRecordForUpdate(clue.identity, clue.id, {
                updating: true,
                updates: {
                  [requestId]: request
                }
              })
            });
          }

          const newItemRecordBlank = {
            originalRequestId: payload.requestId,
            lastRequestId: payload.requestId,
            pending: true,
            meta: new MetaRecord({ clue, options, custom: options && options.custom })
          };

          const existingItem = api.selectors.byClue(() => clue, options)({ [apiOptions.storeKey]: state });
          if (clue.query === queries.CREATE && options && options.marker) {
            if (options.index != undefined && existingItem && existingItem.toJSON) {
              const existingItemArray = existingItem.toJSON();
              if (existingItemArray[options.index]) {
                newItemRecordBlank.originalRequestId = existingItemArray[options.index].originalRequestId;
              }
            }
          }
          if ([queries.FIND, queries.FIND_ONE, queries.FIND_BY_ID].includes(clue.query)) {
            if (existingItem && !(options && options.force)) { return state; }
          }
          const requestedItem = new ItemRecord(newItemRecordBlank);

          let key = clue.serialize();
          let value = requestedItem;
          if (clue.query === queries.CREATE && options && options.marker) {
            key = options.marker;
            try {
              const existingArray = state.get(clue.identity).get(clue.query).get(key);
              if (options.index != undefined) {
                value = existingArray.slice(0, options.index)
                  .concat([requestedItem])
                  .concat(existingArray.slice(options.index + 1));
              } else {
                value = existingArray.concat([requestedItem]);
              }
            } catch(err) {
              value = [requestedItem];
            }
          }

          return state.mergeDeep({
            _requests: {
              [requestId]: { clue, options, requestedItem }
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
          let existingItem = (clue.query !== queries.UPDATE)
            && api.selectors.byClue(() => clue, options)({ [apiOptions.storeKey]: state });

          if (clue.query === queries.CREATE && options && options.marker) {
            const existingArray = state.get(clue.identity).get(clue.query).get(options.marker);
            const index = _.findIndex(existingArray.toJSON(), item => item.lastRequestId === payload.requestId);
            existingItem = existingArray && existingArray.get(index);
          }

          const existingItemJSON = existingItem && existingItem.toJSON();
          const resultItem = new ItemRecord(
            _.merge(
              {},
              existingItemJSON,
              {
                pending: false,
                error: !!isError,
                success: !isError,
                meta: new MetaRecord({
                  clue,
                  options, 
                  responseMeta: responseMeta,
                  fetchedAt: new Date().getTime(),
                  custom: (existingItemJSON && existingItemJSON.meta && existingItemJSON.meta.custom)
                }),
                data
              }
            )
          );

          if (clue.query === queries.UPDATE) {
            const request = { clue, options };
            const instanceRecordPatch = {
              updating: false,
              updates: {
                [requestId]: {
                  pending: false,
                  error: isError,
                  success: !isError,
                  data
                }
              }
            };
            if (pseudoClue.event === events.SUCCESS) {
              instanceRecordPatch.data = data;
            }
            const identityPatch = getPatchedIdentityRecordForUpdate(clue.identity, clue.id, instanceRecordPatch);

            let resultState = state.mergeDeep({
              _requests: {
                [requestId]: { result: resultItem }
              },
              [clue.identity]: identityPatch
            });
            // if (!isError) {
            //   resultState = resultState.set('_requests', state._requests.delete(String(requestId)));
            // }
            return resultState;
          }

          let key = clue.serialize();
          let value = resultItem;
          if (clue.query === queries.CREATE && options && options.marker) {
            key = options.marker;

            const existingArray = state.get(clue.identity).get(clue.query).get(key);
            const index = _.findIndex(existingArray.toJSON(), item => item.lastRequestId === payload.requestId);

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
              [requestId]: { result: resultItem }
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
      yield takeEvery("*", workerSaga);
    }
  };

  const workerSaga = function* (action) {
    const pseudoClue = Clue.pseudoClueFromActionType(action.type);
    if (!pseudoClue || pseudoClue.event !== events.REQUEST) {
      return;
    }

    const { type, payload } = action;
    const { identity, clue, subtype, options } = payload;

    switch (pseudoClue.query) {
      case queries.CREATE:
      case queries.UPDATE:
      case queries.FIND:
      case queries.FIND_BY_ID:
      case queries.FIND_ONE:
      case queries.DELETE: {
        // const existingItem = api.selectors.byClue(() => clue)({ [apiOptions.storeKey]: state });
        if (pseudoClue.query !== queries.CREATE && pseudoClue.query !== queries.UPDATE) {
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

        let response;
        try {
          response = yield call(axios.request, Object.assign({}, apiOptions.axios, {
            url,
            method,
            headers,
            data
          }));
        } catch (error) {
          if (error.response) {
            response = error.response;
          } else {
            yield put(api.actions.error(
              payload.requestId,
              clue,
              { error: error.message },
              null,
              options
            ));
            return;
          }
        }

        const statusFloored = 100 * Math.floor(response.status / 100);
        if (statusFloored === 200) {
          const data = pseudoClue.query === queries.FIND_ONE
            ? response.data[0]
            : response.data;

          yield put(api.actions.success(
            payload.requestId,
            clue,
            response.headers,
            data,
            options
          ));
        } else {
          yield put(api.actions.error(
            payload.requestId,
            clue,
            Object.assign({}, response.headers, { status: response.status }),
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
