import { createSelector } from "reselect";
import { Record, Map } from "immutable";
import _ from "lodash";

export const events = {
  REQUEST: "request",
  SUCCESS: "success",
  ERROR: "error"
};

export const queries = {
  FIND_BY_ID: "findById",
  FIND_ONE: "findOne",
  FIND: "find"
};

const moduleName = "redux-clue";

const DEFAULT_OPTIONS = {
  storeKey: moduleName
};

const CLUE_DEFAULTS = {
  query: queries.FIND_BY_ID,

  identity: null,
  limit: 0,
  skip: 0,
  id: null,
  where: null,
  filter: null,
  sort: null,

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

  toActionType() {
    return `${moduleName}:${events.REQUEST}:${this.query}:${this.identity}:${this.serialize()}`;
  }

  doesFitPseudoClue(pseudoClue) {
    return this.identity === pseudoClue.identity && this.query === pseudoClue.query;
  }

  static pseudoClueFromActionType(actionType) {
    const parts = actionType.split(":");
    if (parts.length !== 5) { return null; }
    if (parts[0] !== moduleName) { return null; }

    let data = {
      event: events.REQUEST,
      query: parts[2],
      identity: parts[3]
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
      }
    },
    reducer: (state = defaultState, action) => {
      if (!action) { return state; }

      const { type, payload } = action;
      const pseudoClue = Clue.pseudoClueFromActionType(type);
      if (!pseudoClue) { return state; }

      const { clue, requestId } = payload;
      if (!clue.doesFitPseudoClue(pseudoClue)) {
        throw new Error("Clue should fit data from action.type");
      }

      switch (pseudoClue.event) {
        case events.REQUEST:
          const existingItem = api.selectors.byClue(() => clue)({ [options.storeKey]: state });
          if (existingItem && !clue.force) { return state; }
          const item = new ItemRecord({
            pending: true,
            meta: new MetaRecord({ clue })
          });
          return state.mergeDeep({
            _requests: {
              [requestId]: item
            },
            [clue.identity]: {
              [clue.query]: {
                [clue.serialize()]: item
              }
            }
          });
      }

      return state;
    }
  };

  return api;
}