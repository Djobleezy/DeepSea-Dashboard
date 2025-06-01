$(document).keydown(function (event) {
    if (!event.altKey) {
        return;
    }

    switch (event.keyCode) {
        case 49: // Alt+1 -> Dashboard
            window.location.href = '/dashboard';
            event.preventDefault();
            break;
        case 50: // Alt+2 -> Workers
            window.location.href = '/workers';
            event.preventDefault();
            break;
        case 51: // Alt+3 -> Earnings
            window.location.href = '/earnings';
            event.preventDefault();
            break;
        case 52: // Alt+4 -> Blocks
            window.location.href = '/blocks';
            event.preventDefault();
            break;
        case 53: // Alt+5 -> Notifications
            window.location.href = '/notifications';
            event.preventDefault();
            break;
        default:
            break;
    }
});
