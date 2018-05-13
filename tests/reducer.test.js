import ReduxClue, { queries, events } from "../lib/index";

describe("Reducer", () => {
  let api;
  beforeAll(()=> {
    api = ReduxClue({
      models: ["user", "product"]
    })
  });
  describe("Request event", () => {
    test("New request should create new item in _requests and [identity]", () => {
      const action = api.actions.byClue({
        identity: "user",
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
        user: {
          [action.payload.clue.query]: {
            [action.payload.clue.serialize()]: expectedItem
          }
        }
      });
    });
    test("Second request should create new item only in _requests", () => {
      const clueData = {
        identity: "user",
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
          [action1.payload.requestId]: expectedItem,
        },
        user: {
          [action1.payload.clue.query]: {
            [action1.payload.clue.serialize()]: expectedItem
          }
        }
      });
      expect(state2.user[action1.payload.clue.query].size).toEqual(1);
      expect(state2._requests.size).toEqual(1);
    });
  });
});