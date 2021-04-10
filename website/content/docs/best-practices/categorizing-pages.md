---
title: Categorizing pages
---
# Categorizing pages

There are a variety of ways to categorize content. The simplest way would be to
use subcollections. To use subcollections, create a collection folder, and then
create a subcollection folder within that collection.

Here’s what a sample content structure may look like:


```
.
└── content
    └── posts
        ├── _collection.yaml
        ├── a
        |   ├── _collection.yaml
        |   └── post.md
        └── b
            ├── _collection.yaml
            └── post.md
```


To list categories within the `posts` collection:


```
pod.collection('/content/posts').subcollections
```


To list posts within a subcollection:


```
pod.collection('/content/posts/a').docs()
```


You can also use glob syntax to fetch posts from a specific category:


```
pod.docs(['/content/posts/**'])
```