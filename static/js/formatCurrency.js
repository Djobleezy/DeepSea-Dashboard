(function(root, factory){
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.formatCurrency = factory();
    }
}(typeof self !== 'undefined' ? self : this, function(){
    function formatCurrency(amount) {
        return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    return formatCurrency;
}));

