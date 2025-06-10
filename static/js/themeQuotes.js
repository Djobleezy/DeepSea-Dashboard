(function() {
    const theme_quotes = {
        bitcoin: [
            "If you don't believe it or don't get it, I don't have the time to try to convince you, sorry.",
            "It's very attractive to the libertarian viewpoint if we can explain it properly. I'm better with code than with words though.",
            "The root problem with conventional currency is all the trust that's required to make it work.",
            'The Times 03/Jan/2009 Chancellor on brink of second bailout for banks',
            'It might make sense just to get some in case it catches on.',
            'As a thought experiment, imagine there was a base metal as scarce as gold but with one magical property: it can be transported over a communications channel.',
            'We have proposed a system for electronic transactions without relying on trust.',
            "I'm sure that in 20 years there will either be very large transaction volume or no volume.",
            'Running bitcoin.',
            'Bitcoin seems to be a very promising idea.',
            "Every day that goes by and Bitcoin hasn't collapsed due to legal or technical problems, that brings new information to the market.",
            'The computer can be used as a tool to liberate and protect people, rather than to control them.'
        ],
        deepsea: [
            'Dive deep and explore the unknown.',
            'Whales ahead! Stay sharp.',
            'The ocean whispers its secrets.',
            'The sea, once it casts its spell, holds one in its net of wonder forever.',
            'Below the surface is a whole new realm.',
            "Life is better down where it's wetter.",
            'In the heart of the sea lies endless mystery.',
            'Water is the driving force of all nature.',
            'Dive deep; the treasure you seek is near the seabed.',
            'Every wave tells a story.',
            'Even a single drop can make a wave.',
            'So long, and thanks for all the fish!'
        ],
        matrix: [
            'Welcome to the real world.',
            'There is no spoon.',
            'Follow the white rabbit.',
            'Unfortunately, no one can be told what the Matrix is. You have to see it for yourself.',
            "I can only show you the door. You're the one that has to walk through it.",
            'What is real? How do you define real?',
            'Choice is an illusion created between those with power and those without.',
            'Dodge this.',
            'Ignorance is bliss.',
            "The answer is out there, Neo, and it's looking for you.",
            "Never send a human to do a machine's job.",
            'Free your mind.',
            'I know kung fu.'
        ]
    };

    window.get_theme_quote = function(use_deep_sea, use_matrix) {
        const key = use_matrix ? 'matrix' : (use_deep_sea ? 'deepsea' : 'bitcoin');
        const list = theme_quotes[key];
        return list[Math.floor(Math.random() * list.length)];
    };
})();
