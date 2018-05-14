import ReduxClue, { queries, events } from '../lib/index';

describe('Reducer', () => {
  let api;
  beforeAll(()=> {
    api = ReduxClue({
      models: ['user', 'product']
    })
  });
  describe('Request event', () => {
    test('New request should create new item in _requests and [identity]', () => {
      const action = api.actions.byClue({
        identity: 'user',
        query: queries.FIND_BY_ID,
        id: 1
      });
      action.payload.requestId = Math.random();
      const newState = api.reducer(undefined, action);
      const expectedItem = {
        pending: true,
        error: false,
        data: null,
        meta: {
          clue: action.payload.clue
        }
      };
      expect(newState.toJSON()).toMatchObject({
        _requests: {
          [action.payload.requestId]: expectedItem
        },
        [action.payload.clue.identity]: {
          [action.payload.clue.query]: {
            [action.payload.clue.serialize()]: expectedItem
          }
        }
      });
    });
    test('Second request should create new item only in _requests', () => {
      const clueData = {
        identity: 'user',
        query: queries.FIND_BY_ID,
        id: 1
      };
      const action1 = api.actions.byClue(clueData);
      const action2 = api.actions.byClue(clueData);
      action1.payload.requestId = Math.random();
      action2.payload.requestId = Math.random();

      const state1 = api.reducer(undefined, action1);
      const state2 = api.reducer(state1, action2);

      const expectedItem = {
        pending: true,
        error: false,
        data: null,
        meta: {
          clue: action1.payload.clue
        }
      };
      expect(state2.toJSON()).toMatchObject({
        _requests: {
          [action1.payload.requestId]: expectedItem
        },
        [action1.payload.clue.identity]: {
          [action1.payload.clue.query]: {
            [action1.payload.clue.serialize()]: expectedItem
          }
        }
      });
      expect(state2.user[action1.payload.clue.query].size).toEqual(1);
      expect(state2._requests.size).toEqual(1);
    });
  });

  describe('Success event', () => {
    test('Should remove from _requests and put data into [identity]', () => {
      const clueData = {
        identity: 'user',
        query: queries.FIND_BY_ID,
        id: 1
      };
      const responseHeaders = { someHeader: 'ok' };
      const responseData = { someAttribute: 'some value' };

      const action1 = api.actions.byClue(clueData);
      action1.payload.requestId = Math.random();
      const action2 = api.actions.success(action1.payload.requestId, action1.payload.clue, responseHeaders, responseData);

      const state1 = api.reducer(undefined, action1);
      const state2 = api.reducer(state1, action2);

      expect(state2.toJSON()).toMatchObject({
        [action1.payload.clue.identity]: {
          [action1.payload.clue.query]: {
            [action1.payload.clue.serialize()]: {
              pending: false,
              error: false,
              data: responseData,
              meta: {
                clue: action1.payload.clue,
                fromResponse: responseHeaders
              }
            }
          }
        }
      });
      expect(state2._requests.size).toEqual(0);
    });
  });

  describe('Error event', () => {
    test('Should patch _requests and put data into [identity]', () => {
      const clueData = {
        identity: 'user',
        query: queries.FIND_BY_ID,
        id: 1
      };
      const responseHeaders = { someHeader: 'ok' };
      const responseData = { someAttribute: 'some value' };

      const action1 = api.actions.byClue(clueData);
      action1.payload.requestId = Math.random();
      const action2 = api.actions.error(action1.payload.requestId, action1.payload.clue, responseHeaders, responseData);

      const state1 = api.reducer(undefined, action1);
      const state2 = api.reducer(state1, action2);

      const expectedItem = {
        pending: false,
        error: true,
        data: responseData,
        meta: {
          clue: action1.payload.clue,
          fromResponse: responseHeaders
        }
      };

      expect(state2.toJSON()).toMatchObject({
        _requests: {
          [action1.payload.requestId]: expectedItem
        },
        [action1.payload.clue.identity]: {
          [action1.payload.clue.query]: {
            [action1.payload.clue.serialize()]: expectedItem
          }
        }
      });
    });
  });
});