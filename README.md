# Deschutron's Music Framework
Classes and functions to facilitate making music with the Web Audio API.

Designed to turn an array of numbers into a melody of notes.

    1                => a 440Hz (A) sine wave played for 1 second
    1.with({nl: .5}) => a 440Hz (A) sine wave played for half a second
    2                => an 880Hz (A) sine wave played for 1 second
    [1, 2]           => a 440Hz sine wave for 1s followed by an 880Hz sine wave for 1s
    [[1, 2]]         => a 440Hz sine wave and an 880Hz sine wave played simultaneously for 1s
    [[1, 1.5, 2]]    => an A major chord of sine waves played for 1s
    [[1, 1.5, 2]].with({nl: .25, key: 330}) => an E major chord of sine waves played for 1/4 seconds

You convert to sounds like this:

    Melody.from_numbers([1]).play();
    Melody.from_numbers([[1, 1.5, 2]].with({nl: .25, key: 330})).play();

Using just this framework, I've made these songs:
https://soundcloud.com/deschutron/xeb
https://soundcloud.com/deschutron/step-up
https://soundcloud.com/deschutron/angla
https://soundcloud.com/deschutron/haptera
https://soundcloud.com/deschutron/plug-away-short
