var stripe;
var allPlans = {};
var minPlansForDiscount = 2;
var discountFactor = 0.2;

var stripeElements = function (publicKey) {
  stripe = Stripe(publicKey);
  var elements = stripe.elements();

  // Element styles
  var style = {
    base: {
      fontSize: '16px',
      color: '#32325d',
      fontFamily:
        '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
      fontSmoothing: 'antialiased',
      '::placeholder': {
        color: 'rgba(0,0,0,0.4)'
      }
    }
  };

  var card = elements.create('card', { style: style });

  card.mount('#card-element');

  // Element focus ring
  card.on('focus', function () {
    var el = document.getElementById('card-element');
    el.classList.add('focused');
  });

  card.on('blur', function () {
    var el = document.getElementById('card-element');
    el.classList.remove('focused');
  });

  document.querySelector('#submit').addEventListener('click', function (evt) {
    evt.preventDefault();
    document.querySelector('#submit').disabled = true;
    // Initiate payment
    pay(stripe, card);
  });
};

var pay = function (stripe, card) {
  var cardholderEmail = document.querySelector('#email').value;
  stripe
    .createPaymentMethod('card', card, {
      billing_details: {
        email: cardholderEmail
      }
    })
    .then(function (result) {
      if (result.error) {
        document.querySelector('#submit').disabled = false;
        // The card was declined (i.e. insufficient funds, card has expired, etc)
        var errorMsg = document.querySelector('.sr-field-error');
        errorMsg.textContent = result.error.message;
        setTimeout(function () {
          errorMsg.textContent = '';
        }, 4000);
      } else {
        createCustomer(result.paymentMethod.id, cardholderEmail);
      }
    });
};

var getSelectedPlans = function () {
  return Object.values(allPlans).filter(plan => plan.selected);
};

var onSelectionChanged = function () {
  var selectedPlans = getSelectedPlans();
  updateSummaryTable();
  var showPaymentForm = selectedPlans.length == 0;
  var paymentFormElts = document.querySelectorAll('.sr-payment-form');
  if (showPaymentForm) {
    paymentFormElts.forEach(function (elt) {
      elt.classList.add('hidden');
    });
  } else {
    paymentFormElts.forEach(function (elt) {
      elt.classList.remove('hidden');
    });
  }
};

var updateSummaryTable = function () {
  var computeSubtotal = function () {
    var selectedPlans = getSelectedPlans();
    return selectedPlans
      .map(plan => plan.price)
      .reduce((plan1, plan2) => plan1 + plan2, 0);
  };

  // var computeDiscountPercent = function () {
  //   var selectedPlans = getSelectedPlans();
  //   var eligibleForDiscount = selectedPlans.length >= minPlansForDiscount;
  //   return eligibleForDiscount ? discountFactor : 0;
  // };

  var selectedPlans = getSelectedPlans();
  // var discountPercent = computeDiscountPercent();
  var subtotal = computeSubtotal();
  // var discount = discountPercent * subtotal;
  var total = subtotal;

  var orderSummary = document.getElementById('summary-table');
  if (orderSummary) {
    var buildOrderSummaryRow = function (rowClass, desc, amountCents) {
      return `
          <div class="summary-title ${rowClass}">${capitalize(desc)}</div>
          <div class="summary-price ${rowClass}">${getPriceDollars(amountCents)}</div>
        `;
    };
    orderSummary.innerHTML = '';
    preface = '';
    if (selectedPlans.length == 0) {
      preface = 'No plans selected';
    } else {
      preface = 'Prices listed correspond to a recurrent monthly subscription';

      for (var i = 0; i < selectedPlans.length; i++) {
        orderSummary.innerHTML += buildOrderSummaryRow('summary-product', selectedPlans[i].title, selectedPlans[i].price);
      }
      // if (discount > 0) {
      //   orderSummary.innerHTML += buildOrderSummaryRow('summary-subtotal', 'Subtotal', subtotal);
      //   orderSummary.innerHTML += buildOrderSummaryRow('summary-discount', 'Discount', discount);
      // }
      orderSummary.innerHTML += buildOrderSummaryRow('summary-total', 'Total', total);
    }
    document.getElementById('summary-preface').innerHTML = preface;

  }
};

function capitalize(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function getPriceDollars(price, recurringBy = undefined) {
  var pricePart = '$' + Math.round(price / 100.0);
  if (recurringBy === undefined) {
    return pricePart;
  }
  else {
    return pricePart + '/' + recurringBy;
  }
}

function createCustomer(paymentMethod, cardholderEmail) {
  return fetch('/create-customer', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: cardholderEmail,
      payment_method: paymentMethod,
      plan_ids: getSelectedPlans().map(plan => plan.planId)
    })
  })
    .then(function (response) {
      return response.json();
    })
    .then(function (subscription) {
      if (subscription.error) {
        orderComplete(subscription);
      } else {
        handleSubscription(subscription);
      }
    });
}

function handleSubscription(subscription) {
  if (
    subscription &&
    subscription.latest_invoice &&
    subscription.latest_invoice.payment_intent &&
    subscription.latest_invoice.payment_intent.status === 'requires_action'
  ) {
    stripe
      .confirmCardPayment(
        subscription.latest_invoice.payment_intent.client_secret
      )
      .then(function (result) {
        confirmSubscription(subscription.id);
      });
  } else if (subscription) {
    confirmSubscription(subscription.id);
    orderComplete(subscription);
  } else {
    orderComplete(subscription);
  }
}

function confirmSubscription(subscriptionId) {
  return fetch('/subscription', {
    method: 'post',
    headers: {
      'Content-type': 'application/json'
    },
    body: JSON.stringify({
      subscriptionId: subscriptionId
    })
  })
    .then(function (response) {
      return response.json();
    })
    .then(function (subscription) {
      orderComplete(subscription);
    });
}

function getPublicKey() {
  return fetch('/public-key', {
    method: 'get',
    headers: {
      'Content-Type': 'application/json'
    }
  })
    .then(function (response) {
      return response.json();
    })
    .then(function (json) {
      stripeElements(json.publicKey);
    });
}

function getPlans() {
  return fetch('/plans.json', {
    method: 'get',
    headers: {
      'Content-Type': 'application/json'
    }
  })
    .then(function (response) {
      return response.json();
    })
    .then(function (json) {
      json.forEach(function (plan) {
        plan.selected = false;
        allPlans[plan.planId] = plan;
      });
      generateHtmlForPlansPage();
      onSelectionChanged();
    });
}

getPublicKey();
getPlans();

function generateHtmlForPlansPage() {
  function generateHtmlForSinglePlan(id, animal, price) {
    result = `
        <div class="sr-animal">
          <div class="sr-animal-emoji"
            id=\'${id}\'
            onclick="toggleAnimal(\'${id}\')">
              ${getPriceDollars(price, 'month')}
          </div>
        </div>
      `;
    return result;
  }
  var html = '';
  Object.values(allPlans).forEach((plan) => {
    html += generateHtmlForSinglePlan(plan.planId, plan.title, plan.price);
  });

  document.getElementById('sr-animals').innerHTML += html;
}

function toggleAnimal(id) {
  allPlans[id].selected = !allPlans[id].selected;
  var productElt = document.getElementById(id);
  if (allPlans[id].selected) {
    productElt.classList.add('selected');
  }
  else {
    productElt.classList.remove('selected');
  }

  onSelectionChanged();
}

/* ------- Post-payment helpers ------- */

/* Shows a success / error message when the payment is complete */
var orderComplete = function (subscription) {
  var subscriptionJson = JSON.stringify(subscription, null, 2);
  document.querySelectorAll('.payment-view').forEach(function (view) {
    view.classList.add('hidden');
  });
  document.querySelectorAll('.completed-view').forEach(function (view) {
    view.classList.remove('hidden');
  });
  var orderStatus = document.getElementById('order-status');
  if (subscription.hasOwnProperty('error')) {
    orderStatus.textContent = 'Error creating subscription';
    orderStatus.style.color = 'red';
  } else {
    orderStatus.textContent = 'Your subscription is ' + subscription.status;
    orderStatus.style.color = 'black';
  }
  document.getElementById('sr-animals').classList.add('hidden');
  document.getElementById('request-json').textContent = subscriptionJson;
};
