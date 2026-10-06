1. wm is an SML '97 subset and implementation, with slight modifications that must be easily compileable to SML
2. one way to do things should hold up everywhere, alternative source forms should never compete with each other on things like performance or convinience
3. wm is fp first, doing it the fp way should always be the route with least friction, the compiler should not offer a "less-fp better way" just make the compiler better at compiling fp
4. implicit things should be minimized unless tooling can show it back
5. when ever theres "needed feature" doing it in "userspace" should be heavily explored first, this rule does not apply to features that make an already existing concept more explicit such as explicit capture
