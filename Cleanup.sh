rm -rf node_modules
rm -rf android/build
rm -rf android/.gradle
rm -rf android/app/build
cd android
./gradlew clean
cd ..
#watchman watch-del-all

