# redux-clue

~~~~
import ReduxClue, { Clue, queries } from 'redux-clue'

const clue = ReduxClue({
  storeKey: 'clue',
  apiPrefix: 'api',
  apiPluralize: false,
  models: ['product']
});

const propsToProductClue = props => ({ identity: 'product', query: queries.FIND_ONE, id: props.productId });
const productSelector = clue.selectors.byClue(propsToProductClue);

@connect(
  (state, props) => ({
    product: productSelector(state, props)
  }),
  { requestProduct: clue.actions.byClue }
)
class Component extends React.Component {
  componentDidMount() {
    this.props.requestProduct(propsToProductClue(this.props));
  },
  
  render() {
    return <div>
      { this.props.product && this.props.product.pending && "Loading..." }
      { this.props.product && this.props.product.error && "An error occured!" }
      { this.props.product && this.props.product.data && JSON.stringify(this.props.product.data) }
      <p>
        { JSON.stringify(this.props.product) }
      </p>  
    </div>;
  }
}
~~~~